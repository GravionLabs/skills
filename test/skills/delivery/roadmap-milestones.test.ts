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
  if (a.includes('POST')) return { rest: { number: 99, title: a.find((x) => x.startsWith('title=')).slice(6), state: 'open', html_url: 'https://x/m/99' } };
  if (a.includes('-X')) throw new Error('unexpected write: ' + a.join(' '));
  const m = /issues\\/(\\d+)$/.exec(p);
  if (m) {
    const cur = env('FAKE_CURRENT', '{}')[m[1]];
    if (cur === undefined) throw new Error('404 Not Found');
    return { rest: { number: Number(m[1]), milestone: cur ? { title: cur } : null } };
  }
  if (p.includes('/milestones?')) return { rest: [env('FAKE_MILESTONES', '[]')] };
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
    expect(out.created).toEqual(['M4']);
    expect(out.results).toEqual([{ issue: 5, milestone: 'M4', status: 'set' }]);
    const w = writes(r.calls);
    expect(w[0]).toContain('POST');
    expect(w[1].slice(0, 5)).toEqual(['issue', 'edit', '5', '--milestone', 'M4']);
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
});
