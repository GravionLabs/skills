// deliver: the loop of one repository is a module (run-repository.mts), the stop request a shared object
// (stop-signal.mts). The loop itself is tested through deliver-loop.mts in deliver.test.ts.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  LIMIT_KINDS,
  type RunEvent,
  limits,
} from '../../../skills/delivery/deliver/scripts/gates/limits.mts';
import { profileValidator } from '../../helpers/agent-events-profile';
import { leafStep } from '../../../skills/delivery/deliver-lead/scripts/leaf.mts';
import { markBody } from '../../../skills/delivery/deliver/scripts/review.mts';
import { runLead } from './deliver-lead/fake-host.mts';
import {
  type Outcome,
  type Scenario,
  READY,
  fixture,
  lines,
  loop,
  repo,
  root,
} from './deliver/run-loop';
import { FAKE_LOGIN, create } from './deliver/tracker/fake.mts';

const scripts = path.resolve(__dirname, '../../../skills/delivery/deliver/scripts');
const { StopSignal } = (await import(
  path.join(scripts, 'stop-signal.mts')
)) as typeof import('../../../skills/delivery/deliver/scripts/stop-signal.mts');

describe('StopSignal', () => {
  const watched: InstanceType<typeof StopSignal>[] = [];
  afterEach(() => {
    vi.useRealTimers();
    for (const signal of watched.splice(0)) {
      process.removeListener('SIGINT', signal.request);
      process.removeListener('SIGBREAK', signal.request);
    }
  });

  it('ends every enlisted session of every repository that shares it', () => {
    const signal = new StopSignal();
    const ended: string[] = [];
    signal.enlist(() => ended.push('a'));
    const unlist = signal.enlist(() => ended.push('b'));
    signal.enlist(() => ended.push('c'));
    unlist();
    expect(signal.stopped).toBe(false);
    signal.request();
    expect(signal.stopped).toBe(true);
    expect(ended).toEqual(['a', 'c']);
  });

  it('listens to Ctrl-C once and sees the stop file of any run folder it watches', () => {
    vi.useFakeTimers();
    const signal = new StopSignal();
    watched.push(signal);
    const dir = mkdtempSync(path.join(tmpdir(), 'stop-signal-'));
    try {
      const before = process.listenerCount('SIGINT');
      signal.watch(path.join(dir, 'one', 'stop'));
      signal.watch(path.join(dir, 'stop'));
      expect(process.listenerCount('SIGINT')).toBe(before + 1);
      let ended = false;
      signal.enlist(() => {
        ended = true;
      });
      vi.advanceTimersByTime(500);
      expect(signal.stopped).toBe(false);
      writeFileSync(path.join(dir, 'stop'), '');
      vi.advanceTimersByTime(500);
      expect(signal.stopped).toBe(true);
      expect(ended).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('runObjective', () => {
  it('starts no unit after a stop request during its checkout', async () => {
    const { runObjective } = (await import(
      path.join(scripts, 'objective-run.mts')
    )) as typeof import('../../../skills/delivery/deliver/scripts/objective-run.mts');
    const signal = new StopSignal();
    const issue = (number: number, title: string, labels: string[]) => ({
      repo: 'x/app',
      number,
      title,
      labels,
      body: number === 1 ? '## Affected repos\n- x/app' : '',
      url: '',
      state: 'open' as const,
      milestone: 'M001',
    });
    const runUnit = vi.fn<() => Promise<never>>();
    const result = await runObjective({
      ref: 'x/app#1',
      reader: {
        issue: () => issue(1, '[Objective] o', ['objective']),
        parent: () => undefined,
        subIssues: ({ number }) => (number === 1 ? [issue(2, '[Feature] f', ['feature'])] : []),
        milestones: () => [],
        hasTag: () => false,
        blockers: () => [],
      },
      checkouts: {
        checkout: async (repo) => {
          signal.request();
          return { repo, root: '/nowhere' };
        },
      },
      runUnit,
      pollSeconds: 1,
      idlePolls: 0,
      sleep: async () => {},
      signal,
      say: () => {},
      log: () => {},
      events: { open: () => ({ run: 'r', dir: undefined, origin: {} }), emit: () => {} } as never,
      started: {},
      onCounts: () => {},
    });
    expect(runUnit).not.toHaveBeenCalled();
    expect(result.exitCode).toBe(130);
  });
});

describe('deliver-loop.mts', () => {
  const cli = readFileSync(path.join(scripts, 'deliver-loop.mts'), 'utf8');

  it('runs the repository once through runRepository and exits with its code', () => {
    expect(cli).toContain("from './run-repository.mts'");
    expect(cli.match(/await runRepository\(/g)).toHaveLength(1);
    expect(cli).toContain('process.exit(result.exitCode)');
  });

  it('keeps no mutable state at module level', () => {
    expect(cli).not.toMatch(/^(let|var) /m);
  });
});

// #1194: with `deliver.leafFlow` `step` the loop drives the step script of deliver-lead (leaf-driver.mts over
// process-host.mts). Each scenario runs in both modes: they end with the same stage label, merge calls, hand-over
// comments and limit counts.
fixture();
const profile = profileValidator(
  'deliver@2',
  'skills/delivery/deliver/schema/deliver-profile.schema.json',
);
const MODES = ['legacy', 'step'] as const;
type Mode = (typeof MODES)[number];

/** One PBI that the loop's items and `tracker.issue` (the step script) both know. */
function pbi(id: number, more: Partial<Scenario> = {}, labels: string[] = []): Scenario {
  const title = `[PBI] feat: parity ${id}`;
  return {
    items: [{ id, title, labels }],
    repositories: {
      'fake/repo': { issues: [{ number: id, title, labels: ['pbi', ...labels], body: '' }] },
    },
    shared: true,
    risks: { [id]: 'low' },
    ...more,
  };
}

/** Runs the loop with `deliver.leafFlow` of `mode` in the project config. */
async function inMode(mode: Mode, scenario: Scenario, options: Parameters<typeof loop>[1] = {}) {
  const config = path.join(repo, '.agents', 'config.json');
  mkdirSync(path.dirname(config), { recursive: true });
  if (mode === 'step') writeFileSync(config, JSON.stringify({ deliver: { leafFlow: 'step' } }));
  try {
    return await loop(scenario, {
      ...options,
      args: ['--base', 'release/next', ...(options.args ?? [])],
    });
  } finally {
    rmSync(config, { force: true });
  }
}

/** What a scenario persists for issue `id`: the stage left, the merges, the hand-over comments, the limit counts. */
const persisted = (out: Outcome, id: number) => ({
  stage: out.stages.filter((s) => s.id === id).at(-1)?.stage ?? null,
  merges: out.merges,
  handovers: out.comments.filter((c) => c.marker.startsWith('<!-- deliver-handover')),
  counts: Object.fromEntries(
    LIMIT_KINDS.map((kind) => [
      kind,
      limits({ events: out.events as RunEvent[], issue: id, kind, repo: 'fake/repo' }).evidence
        .count,
    ]),
  ),
});

const approvedMark = (id: number) => ({
  [String(100 + id)]: [
    {
      login: FAKE_LOGIN,
      body: markBody({ verdict: 'approve', findings: [], unmet: [] }, 'abc123', 'low'),
    },
  ],
});

describe('deliver.leafFlow step (#1194)', () => {
  it.each<[string, number, (id: number) => Scenario]>([
    ['the pass path', 201, (id) => pbi(id)],
    ['a fix round', 202, (id) => pbi(id, { verdicts: ['changes', 'approve'] })],
    [
      'a retry of the merge gate',
      203,
      (id) => pbi(id, { gates: [{ state: 'pending', reported: true }, READY] }),
    ],
    ['a hand-over for the risk level', 204, (id) => pbi(id, { risks: { [id]: 'high' } })],
    [
      'the limit of fix rounds',
      205,
      (id) => pbi(id, { verdicts: ['changes', 'changes', 'changes'] }),
    ],
    ['a session without a pull request', 206, (id) => pbi(id, { noPull: true })],
    [
      'a pull request that changes a protected path',
      213,
      (id) => pbi(id, { files: ['.github/workflows/ci.yml'] }),
    ],
    [
      'an earlier pull request that changes a protected path',
      214,
      (id) => pbi(id, { earlierPull: true, files: ['.github/workflows/ci.yml'] }),
    ],
    [
      'two open pull requests of an earlier run',
      215,
      (id) => pbi(id, { earlierPull: true, twoPulls: [id] }),
    ],
    ['a session that asks for a decision', 216, (id) => pbi(id, { needsDecision: true })],
    [
      'a resume from agent:approved',
      207,
      (id) => pbi(id, { earlierPull: true, pullComments: approvedMark(id) }, ['agent:approved']),
    ],
  ])('%s ends alike in both modes', async (_, id, make) => {
    const legacy = await inMode('legacy', make(id));
    const step = await inMode('step', make(id));
    expect(step.status).toBe(legacy.status);
    expect(persisted(step, id)).toEqual(persisted(legacy, id));
    expect(step.results.map((r) => [r.issue, r.outcome, r.reason])).toEqual(
      legacy.results.map((r) => [r.issue, r.outcome, r.reason]),
    );
    profile.expectRun(step.events as never);
  });

  it('never checks out a protected path: no review session in either mode', async () => {
    const make = () => pbi(217, { files: ['.github/workflows/ci.yml'] });
    for (const mode of MODES) expect((await inMode(mode, make())).reviews).toEqual([]);
    const earlier = await inMode('step', pbi(218, { earlierPull: true, twoPulls: [218] }));
    expect(earlier.sessions).toEqual([]);
  });

  it('ends the run with exit 5 at the third harness failure in a row, as legacy does', async () => {
    const silent = { exit: 1, noPull: true, silent: true };
    const issue = (id: number) => ({
      number: id,
      title: `[PBI] feat: parity ${id}`,
      labels: ['pbi'],
    });
    const make = (): Scenario => ({
      ...pbi(219, { plan: [silent, silent, silent, silent] }),
      items: [219, 220].map((id) => ({ id, title: `[PBI] feat: parity ${id}` })),
      repositories: { 'fake/repo': { issues: [issue(219), issue(220)] } },
    });
    const legacy = await inMode('legacy', make());
    const step = await inMode('step', make());
    expect(legacy.status).toBe(5);
    expect(step.status).toBe(5);
    // three failed sessions, then nothing more starts
    expect(step.sessions).toHaveLength(3);
    expect(step.stdout).toContain('harness failed (exit 1, 1 in a row): waits 5 min');
  });

  it.each([
    ['--merge-risk', 'high'],
    ['--model', 'opus'],
    ['--review-model', 'opus'],
  ])('refuses %s with deliver.leafFlow step before any session (exit 64)', async (flag, value) => {
    const out = await inMode('step', pbi(222), { args: [flag, value] });
    expect(out.status).toBe(64);
    expect(out.stderr).toContain(`${flag} is not read with deliver.leafFlow step`);
    expect(out.sessions).toEqual([]);
  });

  it('a leaf the step loop left in review is finished by deliver-lead, merged once', async () => {
    const id = 211;
    const out = await inMode('step', pbi(id, { hangsOn: [`review:${id}`] }), {
      whenStdout: (text, stop) => {
        // the hanging reviewer runs
        if (/result: pr[\s\S]*working/.test(text)) stop();
      },
    });
    expect(out.status).toBe(130);
    expect(persisted(out, id).stage).toBe('review');
    // the tracker shows the label the loop wrote
    writeFileSync(
      path.join(out.dir, 'scenario.json'),
      JSON.stringify(pbi(id, {}, ['agent:review'])),
    );
    const run = path.basename(out.eventsFile, '.jsonl');
    const report = await lead(out.dir, id, { run, events: path.dirname(out.eventsFile) });
    expect(report).toMatchObject({ outcome: 'merged' });
    expect(
      lines<{ call: string; pull: number }>(path.join(out.dir, 'calls.jsonl')).filter(
        (c) => c.call === 'merge' && c.pull === 100 + id,
      ),
    ).toHaveLength(1);
    profile.expectRun(lines(out.eventsFile) as never);
  });

  it('a leaf deliver-lead left in review is finished by the step loop, merged once', async () => {
    const id = 212;
    const dir = path.join(root, `lead-${id}`);
    mkdirSync(dir);
    writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(pbi(id)));
    // the lead ends after it started the reviewer: the label says review, the pull request is open
    const ended = await lead(dir, id, { events: path.join(dir, 'lead-events'), max: 4 });
    expect(ended).toBeUndefined();
    expect(lines<{ stage: string }>(path.join(dir, 'stages.jsonl')).at(-1)?.stage).toBe('review');
    const out = await inMode('step', pbi(id, {}, ['agent:review']), { resume: dir });
    expect(out.status).toBe(0);
    expect(out.merges.filter((m) => m.pull === 100 + id)).toHaveLength(1);
    // the loop reviewed the open pull request and started no implementer
    expect(out.sessions).toEqual([]);
    expect(out.reviews).toHaveLength(1);
    profile.expectRun(out.events as never);
  });

  it('ends with usage (exit 64) before any session for an unknown deliver.leafFlow', async () => {
    const config = path.join(repo, '.agents', 'config.json');
    mkdirSync(path.dirname(config), { recursive: true });
    writeFileSync(config, JSON.stringify({ deliver: { leafFlow: 'tree' } }));
    try {
      const out = await loop(pbi(221));
      expect(out.status).toBe(64);
      expect(out.stderr).toContain('deliver.leafFlow is legacy or step, not "tree"');
      expect(out.sessions).toEqual([]);
      expect(out.events).toEqual([]);
    } finally {
      rmSync(config, { force: true });
    }
  });
});

/**
 * deliver-lead on the fake host (fake-host.mts) for issue `id` over the case directory `dir`: resumes `run` when
 * given, else starts a run of its own. Ends with the report, or undefined after `max` actions.
 */
async function lead(
  dir: string,
  id: number,
  { run, events, max = 40 }: { run?: string; events: string; max?: number },
) {
  const saved = { cwd: process.cwd(), env: { ...process.env } };
  Object.assign(process.env, {
    FAKE_DIR: dir,
    DELIVER_TRACKER_DIR: path.join(__dirname, 'deliver', 'tracker'),
  });
  // the guard and merge-approved CLIs judge the checkout of the working directory
  process.chdir(repo);
  try {
    const tracker = create({ cwd: repo, selection: {}, trustAuthors: false, base: 'release/next' });
    let first = run !== undefined;
    const out = await runLead(
      (result) => {
        const resume = first;
        first = false;
        return leafStep({
          tracker,
          events,
          issue: id,
          run: run ?? `lead-${id}`,
          result,
          resume,
          cwd: repo,
          layers: [],
        });
      },
      { fakeDir: dir, issue: id, max, prefix: 'lead-' },
    );
    return out.report;
  } catch (error) {
    if (String(error).includes('no end after')) return undefined;
    throw error;
  } finally {
    process.chdir(saved.cwd);
    process.env = saved.env;
  }
}
