import Ajv2020 from 'ajv/dist/2020';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-milestone/scripts/Get-Milestones.ps1');

// #439: Get-Milestones.ps1 -Mode assign against a fake gh (GETs answer from FAKE_* env JSON, `gh issue edit` is recorded).
const handler = `(call) => {
  const env = (k, d) => JSON.parse(process.env[k] || d);
  const a = call.args;
  if (a[0] === 'issue' && a[1] === 'edit') return { rest: {} };
  if (a.includes('-X')) throw new Error('unexpected write: ' + a.join(' '));
  const p = a[1];
  const sub = /issues\\/(\\d+)\\/sub_issues/.exec(p);
  if (sub) return { rest: env('FAKE_SUBS', '{}')[sub[1]] || [] };
  const m = /issues\\/(\\d+)$/.exec(p);
  if (m) {
    const i = env('FAKE_ISSUES', '{}')[m[1]];
    if (!i) throw new Error('404 Not Found');
    return { rest: { number: Number(m[1]), title: 'T' + m[1], repository_url: 'https://api.github.com/repos/o/r', labels: (i.labels || []).map((name) => ({ name })), milestone: i.milestone ? { title: i.milestone } : null, parent_issue_url: i.parent ? 'https://api.github.com/repos/o/r/issues/' + i.parent : undefined } };
  }
  if (p.includes('/milestones?')) return { rest: [env('FAKE_MILESTONES', '[]')] };
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

describe('Get-Milestones.ps1 -Mode assign', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-assign-'));
    fake = createFakeGh(tmp, handler);
  });
  afterAll(() => worker.close());

  const milestones = [ms(1, 'M003 Market'), ms(2, 'M004'), ms(3, 'M002 (1.0.0)', 'closed')];
  const assign = async (
    name: string,
    issues: string,
    issueData: Record<string, unknown>,
    subs: Record<string, unknown> = {},
    extra: string[] = [],
  ) => {
    const before = fake.calls().length;
    const r = await worker.run(['-Mode', 'assign', '-Name', name, '-Issues', issues, ...extra], {
      cwd: tmp,
      env: {
        ...fake.env(),
        FAKE_MILESTONES: JSON.stringify(milestones),
        FAKE_ISSUES: JSON.stringify(issueData),
        FAKE_SUBS: JSON.stringify(subs),
      },
    });
    const calls = fake.calls().slice(before);
    const writes = calls
      .filter((c) => c.args[0] === 'issue' && c.args[1] === 'edit')
      .map((c) => c.args.slice(0, 5));
    return {
      r,
      writes,
      posts: calls.filter((c) => c.args.includes('POST')),
      out: r.status === 0 ? JSON.parse(r.stdout) : null,
    };
  };
  const pbi = (milestone: string | null = null, extra: object = {}) => ({
    labels: ['pbi'],
    milestone,
    ...extra,
  });

  it('sets M<n> (numeric lookup finds the padded title with topic) and reports previous', async () => {
    const { out, writes } = await assign('M3', '1,#2', { 1: pbi(), 2: pbi('M004') });
    expect(out.milestone).toMatchObject({ number: 1, title: 'M003 Market' });
    expect(out.assigned).toEqual([
      { number: 1, previous: null, milestone: 'M003 Market', status: 'set' },
      { number: 2, previous: 'M004', milestone: 'M003 Market', status: 'set' },
    ]);
    expect(writes).toEqual([
      ['issue', 'edit', '1', '--milestone', 'M003 Market'],
      ['issue', 'edit', '2', '--milestone', 'M003 Market'],
    ]);
  });

  it('a re-run changes nothing (unchanged)', async () => {
    const { out, writes } = await assign('M003', '1', { 1: pbi('M003 Market') });
    expect(out.assigned).toEqual([
      { number: 1, previous: 'M003 Market', milestone: 'M003 Market', status: 'unchanged' },
    ]);
    expect(writes).toEqual([]);
  });

  it('-DryRun prints the result and writes nothing', async () => {
    const { out, writes } = await assign('M3', '1', { 1: pbi() }, {}, ['-DryRun']);
    expect(out.dryRun).toBe(true);
    expect(out.assigned[0].status).toBe('set');
    expect(writes).toEqual([]);
  });

  it('-DryRun plans against a missing milestone and still applies the Epic rule', async () => {
    const ok = await assign('M9', '1', { 1: pbi() }, {}, ['-DryRun']);
    expect(ok.r.status).toBe(0);
    expect(ok.out.assigned[0].status).toBe('set');
    expect(ok.writes).toEqual([]);
    expect(ok.posts).toEqual([]);
    const epic = await assign('M9', '2', { 2: { labels: ['epic'] } }, {}, ['-DryRun']);
    expect(epic.r.status).toBe(1);
    expect(epic.r.stderr).toContain('Epic never has a milestone');
  });

  it('-DryRun against a missing milestone validates against the schema (number null, state missing)', async () => {
    const { r, out } = await assign('M9', '1', { 1: pbi() }, {}, ['-DryRun']);
    expect(r.status).toBe(0);
    expect(out.milestone).toEqual({ number: null, title: 'M9', state: 'missing', url: null });
    const schema = JSON.parse(
      fs.readFileSync(
        path.join(root, 'skills/github/github-milestone/schema/milestones.schema.json'),
        'utf8',
      ),
    );
    const ajv = new Ajv2020({ strict: false });
    expect(ajv.validate(schema, out)).toBe(true);
  });

  it.each([
    ['an unknown milestone (not created, hint create)', 'M9', /not found; create it first/],
    ['a closed milestone', 'M2', /closed/],
    ['an invalid name', 'Next', /invalid milestone name/],
  ])('%s: exit 1, nothing written', async (_c, name, msg) => {
    const { r, writes, posts } = await assign(name, '1', { 1: pbi() });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(msg);
    expect(writes).toEqual([]);
    expect(posts).toEqual([]);
  });

  it('an unknown issue: exit 1, nothing written, also for the issues before it', async () => {
    const { r, writes } = await assign('M3', '1,7', { 1: pbi() });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('#7 not found');
    expect(writes).toEqual([]);
  });

  it('refuses an Epic, nothing written', async () => {
    const { r, writes } = await assign('M3', '1,2', { 1: pbi(), 2: { labels: ['epic'] } });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Epic never has a milestone');
    expect(writes).toEqual([]);
  });

  it('none clears an Epic without a warning', async () => {
    const { out } = await assign('none', '2', { 2: { labels: ['epic'], milestone: 'M004' } });
    expect(out.milestone).toBeNull();
    expect(out.assigned).toEqual([{ number: 2, previous: 'M004', milestone: null, status: 'set' }]);
    expect(out.warnings).toEqual([]);
  });

  describe('Feature', () => {
    const feature = { 5: { labels: ['feature'] } };
    it.each([
      ['an open PBI without milestone', [{ number: 6, state: 'open', milestone: null }], '#6'],
      [
        'an open PBI in another milestone',
        [{ number: 6, state: 'open', milestone: { title: 'M004' } }],
        '#6',
      ],
      [
        'a sub-issue of another repository with the same milestone title',
        [
          {
            number: 6,
            state: 'open',
            milestone: { title: 'M003 Market' },
            repository_url: 'https://api.github.com/repos/o/other',
          },
        ],
        'o/other#6',
      ],
    ])('refused with %s: nothing written', async (_c, subs, outside) => {
      const { r, writes } = await assign('M3', '5', feature, { 5: subs });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(`outside: ${outside}`);
      expect(writes).toEqual([]);
    });

    it('allowed when its PBIs are in the call or already there; closed ones do not count', async () => {
      const { out, writes } = await assign(
        'M3',
        '5,6',
        { ...feature, 6: pbi() },
        {
          5: [
            { number: 6, state: 'open', milestone: null },
            { number: 7, state: 'open', milestone: { title: 'M003 Market' } },
            { number: 8, state: 'closed', milestone: null },
          ],
        },
      );
      expect(out.assigned.map((x: { status: string }) => x.status)).toEqual(['set', 'set']);
      expect(writes).toHaveLength(2);
    });
  });

  describe('none', () => {
    it('clears with --remove-milestone and warns for a PBI and a Bug', async () => {
      const before = fake.calls().length;
      const { out } = await assign('none', '1,2', {
        1: pbi('M003 Market'),
        2: { labels: ['bug'], milestone: 'M003 Market' },
      });
      expect(out.assigned).toEqual([
        { number: 1, previous: 'M003 Market', milestone: null, status: 'set' },
        { number: 2, previous: 'M003 Market', milestone: null, status: 'set' },
      ]);
      expect(out.warnings.map((w: { message: string }) => w.message)).toEqual([
        'warning: #1 has no milestone',
        'warning: #2 has no milestone',
      ]);
      const edits = fake
        .calls()
        .slice(before)
        .filter((c) => c.args[1] === 'edit')
        .map((c) => c.args.slice(0, 4));
      expect(edits).toEqual([
        ['issue', 'edit', '1', '--remove-milestone'],
        ['issue', 'edit', '2', '--remove-milestone'],
      ]);
    });

    it('reports feature-incomplete when the Feature of the cleared PBI keeps the milestone', async () => {
      const { out } = await assign('none', '1', {
        1: pbi('M003 Market', { parent: 5 }),
        5: { labels: ['feature'], milestone: 'M003 Market' },
      });
      expect(out.warnings.map((w: { type: string }) => w.type)).toEqual([
        'no-milestone',
        'feature-incomplete',
      ]);
      expect(out.warnings[1]).toMatchObject({
        number: 5,
        outside: [{ number: 1, milestone: 'none' }],
      });
    });

    it('an already cleared issue is unchanged', async () => {
      const { out, writes } = await assign('none', '1', { 1: pbi() });
      expect(out.assigned[0].status).toBe('unchanged');
      expect(writes).toEqual([]);
    });
  });
});
