import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const skill = path.join(root, 'skills/delivery/roadmap');
const script = path.join(skill, 'scripts/Get-RoadmapState.ps1');

// Get-RoadmapState.ps1 against a fake gh that answers the REST GET paths from FAKE_* env JSON.
const handler = `(call) => {
  const env = (k, d) => JSON.parse(process.env[k] || d);
  const [, p] = call.args;
  if (call.args.includes('-X')) throw new Error('write call: ' + call.args.join(' '));
  const m = /issues\\/(\\d+)\\/(parent|dependencies\\/blocked_by)$/.exec(p);
  if (m && m[2] === 'parent') {
    const parent = env('FAKE_PARENTS', '{}')[m[1]];
    if (!parent) throw new Error('404 Not Found');
    return { rest: { number: parent } };
  }
  if (m) return { rest: env('FAKE_BLOCKERS', '{}')[m[1]] || [] };
  if (p.includes('/issues?')) return { rest: [env('FAKE_ISSUES', '[]')] };
  if (p.includes('/milestones?')) return { rest: [env('FAKE_MILESTONES', '[]')] };
  if (p.includes('/tags?')) return { rest: [env('FAKE_TAGS', '[]').map((name) => ({ name }))] };
  throw new Error('unexpected path ' + p);
}`;

const issue = (number: number, label: string, extra: Record<string, unknown> = {}) => ({
  number,
  title: `[${label}] issue ${number}`,
  body: '',
  labels: [{ name: label }],
  milestone: null,
  html_url: `https://github.com/o/r/issues/${number}`,
  ...extra,
});
const ms = (number: number, title: string, open = 0, closed = 0, state = 'open') => ({
  number,
  title,
  state,
  open_issues: open,
  closed_issues: closed,
  due_on: null,
  html_url: `https://x/m/${number}`,
});

describe('Get-RoadmapState.ps1', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-'));
    fake = createFakeGh(tmp, handler);
  });
  afterAll(() => worker.close());

  const state = async (env: Record<string, unknown>) => {
    const r = await worker.run([], {
      cwd: tmp,
      env: {
        ...fake.env(),
        ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, JSON.stringify(v)])),
      },
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };

  it('lists open work items with level, size, parent, milestone and the milestone progress', async () => {
    const out = await state({
      FAKE_ISSUES: [
        issue(2, 'feature', { milestone: { title: 'M1' } }),
        issue(1, 'epic'),
        issue(3, 'pbi', { body: 'Parent Feature: #2\n\nSize: M\n', milestone: { title: 'M1' } }),
        issue(4, 'bug', { labels: [{ name: 'bug' }, { name: 'size:S' }] }),
        issue(5, 'docs'),
        issue(6, 'pbi', { pull_request: {} }),
      ],
      FAKE_PARENTS: { 2: 1, 3: 2 },
      FAKE_MILESTONES: [ms(1, 'M1', 1, 3), ms(2, 'M2 (1.0.0)', 0, 2, 'closed')],
      FAKE_TAGS: ['v1.0.0'],
    });
    expect(out.issues.map((i: any) => [i.number, i.level, i.size, i.parent, i.milestone])).toEqual([
      [1, 'epic', null, null, null],
      [2, 'feature', null, 1, 'M1'],
      [3, 'pbi', 'M', 2, 'M1'],
      [4, 'bug', 'S', null, null],
    ]);
    expect(out.issues[2].url).toBe('https://github.com/o/r/issues/3');
    expect(out.milestones.map((m: any) => [m.title, m.progress])).toEqual([
      ['M1', 75],
      ['M2 (1.0.0)', 100],
    ]);
    expect(out.latestTag).toBe('v1.0.0');
  });

  it('prints empty lists and no milestone when the repository has neither', async () => {
    const out = await state({ FAKE_ISSUES: [issue(7, 'pbi')], FAKE_MILESTONES: [], FAKE_TAGS: [] });
    expect(out.milestones).toEqual([]);
    expect(out.issues).toHaveLength(1);
    expect(out.issues[0]).toMatchObject({ number: 7, milestone: null, parent: null, blockedBy: [] });
    const none = await state({ FAKE_ISSUES: [], FAKE_MILESTONES: [], FAKE_TAGS: [] });
    expect(none.issues).toEqual([]);
  });

  it('keeps legacy x.y.z milestone titles next to M<n>', async () => {
    const out = await state({
      FAKE_ISSUES: [issue(8, 'pbi', { milestone: { title: '1.2.0' } }), issue(9, 'pbi', { milestone: { title: 'M3' } })],
      FAKE_MILESTONES: [ms(5, 'M3', 1, 0), ms(4, '1.2.0', 1, 1)],
      FAKE_TAGS: ['v1.1.0'],
    });
    expect(out.issues.map((i: any) => i.milestone)).toEqual(['1.2.0', 'M3']);
    expect(out.milestones.map((m: any) => m.title)).toEqual(['1.2.0', 'M3']);
  });

  it('reports only open blockers in blockedBy', async () => {
    const out = await state({
      FAKE_ISSUES: [issue(10, 'pbi'), issue(11, 'pbi')],
      FAKE_BLOCKERS: {
        11: [
          { number: 10, state: 'open' },
          { number: 3, state: 'closed' },
        ],
      },
      FAKE_MILESTONES: [],
      FAKE_TAGS: [],
    });
    expect(out.issues.map((i: any) => i.blockedBy)).toEqual([[], [10]]);
  });

  it('makes only GET requests', async () => {
    await state({ FAKE_ISSUES: [issue(12, 'pbi')], FAKE_MILESTONES: [], FAKE_TAGS: [] });
    expect(fake.calls().every((c) => !c.args.includes('-X') && !c.args.includes('graphql'))).toBe(true);
  });
});
