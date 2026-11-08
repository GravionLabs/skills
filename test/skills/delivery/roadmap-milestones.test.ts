import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const skill = path.join(root, 'skills/delivery/roadmap');
const script = path.join(skill, 'scripts/Set-IssueMilestones.ps1');

// Set-IssueMilestones.ps1 against a fake gh: milestones and the current milestone per issue come from FAKE_* env JSON.
const handler = `(call) => {
  const env = (k, d) => JSON.parse(process.env[k] || d);
  const a = call.args;
  const p = a[1];
  if (a[0] === 'issue' && a[1] === 'edit') return { rest: {} };
  if (a.includes('POST')) { const c = { number: 99, title: a.find((x) => x.startsWith('title=')).slice(6), state: 'open', html_url: 'https://x/m/99' }; require('fs').writeFileSync(__dirname + '/posted.json', JSON.stringify(c)); return { rest: c }; }
  if (a.includes('-X')) throw new Error('unexpected write: ' + a.join(' '));
  const sub = /issues\\/(\\d+)\\/sub_issues/.exec(p);
  if (sub) return { rest: env('FAKE_SUBS', '{}')[sub[1]] || [] };
  const m = /issues\\/(\\d+)$/.exec(p);
  if (m) {
    const cur = env('FAKE_CURRENT', '{}')[m[1]];
    if (cur === undefined) throw new Error('404 Not Found');
    return { rest: { number: Number(m[1]), repository_url: env('FAKE_REPOS', '{}')[m[1]], milestone: cur ? { title: cur } : null, labels: (env('FAKE_LABELS', '{}')[m[1]] || []).map((name) => ({ name })) } };
  }
  if (p.includes('/milestones?')) { const f = __dirname + '/posted.json'; const extra = require('fs').existsSync(f) ? [JSON.parse(require('fs').readFileSync(f, 'utf8'))] : []; return { rest: [env('FAKE_MILESTONES', '[]').concat(extra)] }; }
  if (p.includes('/tags?')) return { rest: [[]] };
  throw new Error('unexpected path ' + p);
}`;

const ms = (number: number, title: string, state = 'open') => ({
  number,
  title,
  state,
  open_issues: 0,
  closed_issues: 0,
  due_on: null,
  html_url: `https://x/m/${number}`,
});

describe('Set-IssueMilestones.ps1', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-ms-'));
    fake = createFakeGh(tmp, handler);
  });
  afterAll(() => worker.close());

  const run = (assignment: unknown, env: Record<string, unknown>) => {
    fs.rmSync(path.join(tmp, 'posted.json'), { force: true });
    const before = fake.calls().length;
    return worker
      .run(
        ['-Assignment', typeof assignment === 'string' ? assignment : JSON.stringify(assignment)],
        {
          cwd: tmp,
          env: {
            ...fake.env(),
            ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, JSON.stringify(v)])),
          },
        },
      )
      .then((r) => ({
        ...r,
        calls: fake
          .calls()
          .slice(before)
          .map((c) => c.args),
      }));
  };
  const writes = (calls: string[][]) =>
    calls.filter((a) => (a[0] === 'issue' && a[1] === 'edit') || a.includes('POST'));

  it('sets the milestones, resolving M<n> to the title with a topic', async () => {
    const r = await run(
      [
        { issue: 1, milestone: 'M3' },
        { issue: 2, milestone: 'M3 Market data' },
        { issue: 3, milestone: '1.0.0' },
      ],
      {
        FAKE_MILESTONES: [ms(1, 'M3 Market data'), ms(2, '1.0.0')],
        FAKE_CURRENT: { 1: null, 2: 'M2', 3: null },
      },
    );
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.created).toEqual([]);
    expect(out.results).toEqual([
      { issue: 1, milestone: 'M3 Market data', status: 'set' },
      { issue: 2, milestone: 'M3 Market data', status: 'set' },
      { issue: 3, milestone: '1.0.0', status: 'set' },
    ]);
    expect(writes(r.calls).map((a) => a.slice(0, 5))).toEqual([
      ['issue', 'edit', '1', '--milestone', 'M3 Market data'],
      ['issue', 'edit', '2', '--milestone', 'M3 Market data'],
      ['issue', 'edit', '3', '--milestone', '1.0.0'],
    ]);
  });

  it('is idempotent: issues already in the target milestone are skipped', async () => {
    const r = await run(
      [
        { issue: 1, milestone: 'M3' },
        { issue: 2, milestone: 'M3' },
      ],
      {
        FAKE_MILESTONES: [ms(1, 'M3 Market data')],
        FAKE_CURRENT: { 1: 'M3 Market data', 2: 'M2' },
      },
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).results.map((x: { status: string }) => x.status)).toEqual([
      'unchanged',
      'set',
    ]);
    expect(writes(r.calls)).toHaveLength(1);
  });

  it('creates a missing M<n> before setting it', async () => {
    const r = await run([{ issue: 5, milestone: 'M4' }], {
      FAKE_MILESTONES: [ms(1, 'M3')],
      FAKE_CURRENT: { 5: null },
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.created).toEqual(['M004']);
    expect(out.results).toEqual([{ issue: 5, milestone: 'M004', status: 'set' }]);
    const w = writes(r.calls);
    expect(w[0]).toContain('POST');
    expect(w[1].slice(0, 5)).toEqual(['issue', 'edit', '5', '--milestone', 'M004']);
  });

  it('refuses a closed milestone and writes nothing', async () => {
    const r = await run(
      [
        { issue: 1, milestone: 'M2' },
        { issue: 2, milestone: 'M5' },
      ],
      { FAKE_MILESTONES: [ms(1, 'M2 (1.0.0)', 'closed')], FAKE_CURRENT: { 1: null, 2: null } },
    );
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('closed');
    expect(writes(r.calls)).toEqual([]);
  });

  it.each([
    ['invalid JSON', 'not json', 'valid JSON'],
    ['an invalid milestone name', [{ issue: 1, milestone: 'Next' }], 'invalid milestone name'],
    [
      'a duplicate issue',
      [
        { issue: 1, milestone: 'M1' },
        { issue: 1, milestone: 'M2' },
      ],
      'twice',
    ],
    ['an unknown issue', [{ issue: 7, milestone: 'M1' }], 'not found'],
  ])('exits 1 without writes for %s', async (_n, assignment, msg) => {
    const r = await run(assignment, { FAKE_MILESTONES: [ms(1, 'M1')], FAKE_CURRENT: { 1: null } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(msg);
    expect(writes(r.calls)).toEqual([]);
  });

  // #327: an Epic never has a milestone; a Feature only when all its open PBIs are in it
  describe('milestone rule', () => {
    const base = {
      FAKE_MILESTONES: [ms(1, 'M1'), ms(2, 'M2')],
      FAKE_CURRENT: { 1: null, 2: null, 3: null, 4: null },
    };
    it('refuses an Epic without writes', async () => {
      const r = await run([{ issue: 1, milestone: 'M1' }], {
        ...base,
        FAKE_LABELS: { 1: ['epic'] },
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('Epic never has a milestone');
      expect(writes(r.calls)).toEqual([]);
    });

    it.each([
      ['an open PBI without milestone', [{ number: 3, state: 'open', milestone: null }], '#3'],
      [
        'an open PBI in another milestone',
        [{ number: 3, state: 'open', milestone: { title: 'M2' } }],
        '#3',
      ],
    ])('refuses a Feature with %s', async (_n, subs, outside) => {
      const r = await run([{ issue: 1, milestone: 'M1' }], {
        ...base,
        FAKE_LABELS: { 1: ['feature'] },
        FAKE_SUBS: { 1: subs },
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`outside: ${outside}`);
      expect(writes(r.calls)).toEqual([]);
    });

    // #438: a sub-issue from another repository is outside; its number never matches the assignment
    it.each([
      ['a milestone title collision', { title: 'M1' }],
      ['no milestone', null],
    ])('refuses a Feature with a sub-issue from another repository (%s)', async (_n, milestone) => {
      const r = await run(
        [
          { issue: 1, milestone: 'M1' },
          { issue: 3, milestone: 'M1' },
        ],
        {
          ...base,
          FAKE_CURRENT: { 1: null, 3: null },
          FAKE_LABELS: { 1: ['feature'], 3: ['pbi'] },
          FAKE_REPOS: { 1: 'https://api.github.com/repos/o/r' },
          FAKE_SUBS: {
            1: [
              {
                number: 3,
                state: 'open',
                milestone,
                repository_url: 'https://api.github.com/repos/o/other',
              },
            ],
          },
        },
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('outside: o/other#3');
      expect(writes(r.calls)).toEqual([]);
    });

    it('sets a Feature when its PBIs land in the same milestone (assigned now or already there), closed ones do not count', async () => {
      const r = await run(
        [
          { issue: 1, milestone: 'M1' },
          { issue: 3, milestone: 'M1' },
        ],
        {
          ...base,
          FAKE_CURRENT: { 1: null, 3: null },
          FAKE_LABELS: { 1: ['feature'], 3: ['pbi'] },
          FAKE_SUBS: {
            1: [
              { number: 3, state: 'open', milestone: null },
              { number: 4, state: 'open', milestone: { title: 'M1' } },
              { number: 5, state: 'closed', milestone: null },
            ],
          },
        },
      );
      expect(r.status).toBe(0);
      expect(writes(r.calls).map((a) => a[2])).toEqual(['1', '3']);
    });
  });
});
