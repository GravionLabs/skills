// deliver: the `agent:*` stage labels of the loop (#1014): the pure stage functions, the transitions of a run,
// the resume by label against the real GitHub tracker with a fake `gh`, and the label sync.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAGES, stageAfter, stageOf } from '../../../skills/delivery/deliver/scripts/stage.mts';
import { syncLabels } from '../../../skills/delivery/deliver/scripts/sync-labels.mts';
import { create, markedVerdict } from '../../../skills/delivery/deliver/scripts/tracker/github.mts';
import { createFakeGh } from '../../helpers/fake-gh';
import { type Scenario, fixture, loop, skill } from './deliver/run-loop';

fixture();

describe('stageAfter', () => {
  it.each([
    ['session-started', 'implementing'],
    ['pull-opened', 'review'],
    ['verdict-changes', 'changes'],
    ['verdict-approve', 'approved'],
    ['set-aside', 'handover'],
    ['handed-over', 'handover'],
    ['merged', undefined],
  ] as const)('%s gives %s', (event, stage) => {
    expect(stageAfter(event)).toBe(stage);
  });

  it('reads the least advanced of several labels', () => {
    expect(stageOf(['pbi', 'agent:approved', 'Agent:Review'])).toBe('review');
    expect(stageOf(['pbi', 'agent:other'])).toBeUndefined();
  });
});

describe('deliver loop: stage transitions', () => {
  const stages = async (id: number, extra: Partial<Scenario> = {}) => {
    const out = await loop({ items: [{ id, title: '[PBI] feat: staged' }], ...extra });
    return out.stages.map((s) => s.stage);
  };

  it('goes from implementing over changes to approved and removes the label after the merge', async () => {
    expect(await stages(501, { verdicts: ['changes', 'approve'] })).toEqual([
      'implementing',
      'review',
      'changes',
      'implementing',
      'review',
      'approved',
      null,
    ]);
  });

  it.each([
    ['an issue set aside', 502, { noPull: true }, ['implementing', 'handover']],
    [
      'a pull request handed over',
      503,
      { files: ['.claude/settings.json'] },
      ['implementing', 'handover'],
    ],
  ])('marks %s with handover', async (_name, id, extra, expected) => {
    expect(await stages(id, extra)).toEqual(expected);
  });
});

// The loop with the real GitHub tracker; every pull request exists already.
const handler = `(call, ctx) => {
  const fs = require('fs');
  const sc = JSON.parse(fs.readFileSync(process.env.SCENARIO, 'utf8'));
  const a = call.args;
  const line = a.join(' ');
  if (a[0] === 'repo') return { rest: line.includes('defaultBranchRef') ? 'main' : 'o/r' };
  if (a[0] === 'label') return { rest: a[1] === 'list' ? [] : '' };
  if (a[0] === 'pr' && a[1] === 'view') {
    const merged = fs.existsSync(dir + '/merged');
    return { rest: { state: merged ? 'MERGED' : 'OPEN', mergeable: 'MERGEABLE', headRefOid: 'abc123' } };
  }
  if (a[0] === 'pr' && a[1] === 'checks') return { rest: [{ name: 'ci', bucket: 'pass' }] };
  const route = a.find((x, i) => i > 0 && (x === 'user' || x.startsWith('repos/')));
  const issue = { number: sc.id, title: '[PBI] feat: resumed', state: fs.existsSync(dir + '/merged') ? 'closed' : 'open',
    html_url: 'https://example.test/issues/' + sc.id, body: 'b', author_association: 'OWNER',
    created_at: '2026-01-01T00:00:00Z', labels: sc.labels.map((name) => ({ name })) };
  const pull = { number: 900, title: 't', html_url: 'https://example.test/pull/900',
    head: { ref: 'feat/' + sc.id + '-x', sha: 'abc123', repo: { full_name: 'o/r' } }, base: { ref: 'main' } };
  if (route === 'user') return { rest: 'loop-user' };
  if (a.includes('PUT')) { fs.writeFileSync(dir + '/merged', ''); return { rest: {} }; }
  if (a.includes('POST') || a.includes('DELETE')) return { rest: {} };
  if (route.includes('/rules/branches/')) return { rest: [{ type: 'required_status_checks', parameters: { required_status_checks: [{ context: 'ci' }] } }] };
  if (route.includes('/protection/')) return { rest: {} };
  if (route.includes('/check-runs')) return { rest: [{ check_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }] }] };
  if (route.includes('/comments')) return { rest: [sc.comments] };
  if (route.includes('/labels')) return { rest: [issue.labels] };
  if (route.includes('/events') || route.includes('/dependencies/')) return { rest: [[]] };
  if (route.includes('state=closed')) return { rest: [] };
  if (route.includes('/pulls?')) return { rest: [[pull]] };
  if (route.includes('/files')) return { rest: 'src/a.ts' };
  if (route.includes('/compare/')) return { rest: 'base-sha' };
  if (route.includes('/pulls/')) return { rest: pull };
  return { rest: issue };
}`;

const mark = (sha: string, login = 'loop-user', edited = false) => ({
  body: `<!-- deliver-review: approve ${sha} -->\nrecorded`,
  created_at: '2026-01-02T00:00:00Z',
  updated_at: edited ? '2026-01-03T00:00:00Z' : '2026-01-02T00:00:00Z',
  user: { login },
});

describe('deliver loop: resume by label (fake gh)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'deliver-stage-'));
    return () => rmSync(dir, { recursive: true, force: true });
  });

  const resume = async (label: string, comments: unknown[] = []) => {
    const id = 600;
    const fake = createFakeGh(dir, handler);
    const scenario = path.join(dir, 'gh-scenario.json');
    const { writeFileSync } = await import('node:fs');
    writeFileSync(scenario, JSON.stringify({ id, labels: ['pbi', label], comments }));
    const env = fake.env();
    const out = await loop(
      { items: [{ id, title: '[PBI] feat: resumed' }] },
      {
        args: ['--tracker', 'github'],
        env: { PATH: env.PATH as string, SCENARIO: scenario, DELIVER_TRACKER_DIR: '' },
      },
    );
    const calls = fake.calls().map((c) => c.args.join(' '));
    return {
      out,
      merged: calls.some((c) => c.includes('-X PUT') && c.includes('sha=abc123')),
      added: calls.flatMap((c) => /labels\[\]=(agent:\w+)/.exec(c)?.[1] ?? []),
      calls,
    };
  };

  it('agent:approved with the recorded verdict goes straight to the merge gate', async () => {
    const { out, merged, added, calls } = await resume('agent:approved', [mark('abc123')]);
    expect(out.status).toBe(0);
    expect(out.sessions).toEqual([]);
    expect(out.reviews).toEqual([]);
    expect(merged).toBe(true);
    expect(added).toEqual([]);
    expect(calls.some((c) => c.includes('DELETE') && c.endsWith('/labels/agent%3Aapproved'))).toBe(
      true,
    );
    expect(calls.filter((c) => c.startsWith('label create'))).toHaveLength(STAGES.length);
  });

  it.each([
    ['no mark', []],
    ['a mark of another commit', [mark('old000')]],
    ['a mark of another login', [mark('abc123', 'someone')]],
    ['an edited mark', [mark('abc123', 'loop-user', true)]],
  ])('agent:approved with %s is reviewed', async (_name, comments) => {
    const { out, merged, added } = await resume('agent:approved', comments);
    expect(out.sessions).toEqual([]);
    expect(out.reviews).toHaveLength(1);
    expect(added).toContain('agent:review');
    expect(merged).toBe(true);
  });

  it('agent:review starts a review', async () => {
    const { out, calls } = await resume('agent:review');
    expect(out.sessions).toEqual([]);
    expect(out.reviews).toHaveLength(1);
    expect(calls.some((c) => c.includes('<!-- deliver-review: approve abc123 -->'))).toBe(true);
  });

  it.each(['agent:implementing', 'agent:changes'])('%s starts the implementer', async (label) => {
    const { out, added } = await resume(label);
    expect(out.sessions).toHaveLength(1);
    expect(out.reviews).toHaveLength(1);
    expect(added.slice(-2)).toEqual(['agent:review', 'agent:approved']);
  });
});

describe('GitHub tracker: labels', () => {
  let dir: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'deliver-labels-'));
    fake = createFakeGh(
      dir,
      `(call) => {
        const a = call.args;
        if (a[0] === 'repo') return { rest: 'o/r' };
        if (a.includes('DELETE')) throw new Error('gh: Label does not exist (HTTP 404)');
        if (a.includes('POST')) return { rest: {} };
        return { rest: [[{ name: 'pbi' }, { name: 'agent:review' }, { name: 'agent:approved' }]] };
      }`,
    );
    for (const [k, v] of Object.entries(fake.env())) if (v !== undefined) vi.stubEnv(k, v);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes the other agent labels, tolerates a gone one and keeps the label already set', () => {
    const tracker = create({
      cwd: dir,
      base: 'main',
      selection: { issues: [] },
      trustAuthors: false,
    });
    tracker.setStage({ id: 7, title: '', url: '', labels: [], body: '' }, 'approved');
    const writes = fake.calls().filter((c) => c.args.includes('-X'));
    expect(writes.map((c) => c.args.slice(2, 4).join(' '))).toEqual([
      'DELETE repos/o/r/issues/7/labels/agent%3Areview',
    ]);
  });

  it('syncLabels creates only the missing labels, with color and description', () => {
    const calls: string[][] = [];
    const existing = [{ name: 'agent:review' }];
    const gh = (...args: string[]) => {
      calls.push(args);
      if (args[1] === 'list') return JSON.stringify(existing);
      existing.push({ name: args[2] as string });
      return '';
    };
    expect(syncLabels(gh, 'o/r')).toEqual(
      STAGES.filter((s) => s !== 'review').map((s) => `agent:${s}`),
    );
    expect(calls[1]).toEqual(expect.arrayContaining(['--color', '--description']));
    expect(syncLabels(gh, 'o/r')).toEqual([]);
  });

  it('the latest mark of the commit wins', () => {
    const changes = { ...mark('abc'), body: '<!-- deliver-review: changes abc -->' };
    expect(markedVerdict([mark('abc'), changes], 'loop-user', 'abc')).toBe('changes');
  });
});

describe('agent labels in the skills', () => {
  it.each(['SKILL.md', '../deliver-review/SKILL.md'])(
    '%s forbids sessions to write them',
    (file) => {
      expect(readFileSync(path.join(skill, file), 'utf8')).toMatch(
        /Never add or remove an `agent:\*` label/,
      );
    },
  );
});
