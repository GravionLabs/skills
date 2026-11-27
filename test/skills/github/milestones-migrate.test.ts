import Ajv2020 from 'ajv/dist/2020';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const skill = path.join(root, 'skills/github/github-milestone');
const script = path.join(skill, 'scripts/Get-Milestones.ps1');

// #1074: Get-Milestones.ps1 -Mode migrate against a stateful fake gh: FAKE_STATE is a JSON file
// { repos: { 'o/r': { archived?, milestones, issues, pulls } } }; `gh issue edit` changes it, FAKE_FAIL names issues whose edit fails.
const handler = `(call) => {
  const a = call.args;
  const file = process.env.FAKE_STATE;
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  const opt = (k) => a[a.indexOf(k) + 1];
  if (a[0] === 'repo' && a[1] === 'list') return { rest: Object.keys(state.repos).filter((r) => !state.repos[r].archived).map((nameWithOwner) => ({ nameWithOwner })) };
  if (a[0] === 'issue' && a[1] === 'edit') {
    if ((process.env.FAKE_FAIL || '').split(',').includes(a[2])) throw new Error('boom');
    state.repos[opt('--repo')].issues[a[2]].milestone = a.includes('--remove-milestone') ? null : opt('--milestone');
    fs.writeFileSync(file, JSON.stringify(state));
    return { rest: {} };
  }
  if (a[0] === 'pr' && a[1] === 'view') {
    const pr = state.repos[opt('--repo')].pulls.find((p) => String(p.number) === a[2]);
    return { rest: { closingIssuesReferences: (pr.linked || []).map((number) => ({ number, repository: { name: 'r', owner: { login: 'o' } } })) } };
  }
  if (a.includes('-X')) throw new Error('unexpected write: ' + a.join(' '));
  const [, name, rest] = /^repos\\/([^/]+\\/[^/?]+)(.*)$/.exec(a[1]);
  const repo = state.repos[name];
  const api = 'https://api.github.com/repos/' + name;
  const issue = (n) => {
    const i = repo.issues[n];
    return { number: Number(n), state: i.state || 'open', repository_url: api, labels: i.labels.map((l) => ({ name: l })), milestone: i.milestone ? { title: i.milestone } : null,
      parent_issue_url: i.parent ? (typeof i.parent === 'string' ? i.parent : api + '/issues/' + i.parent) : null };
  };
  if (rest === '') return { rest: { archived: !!repo.archived } };
  if (rest.startsWith('/milestones?state=open')) return { rest: [repo.milestones.filter((m) => m.state === 'open')] };
  if (rest.startsWith('/pulls?state=open&base=release/next')) return { rest: [repo.pulls || []] };
  const list = /^\\/issues\\?milestone=(\\d+)&state=open/.exec(rest);
  if (list) {
    const title = repo.milestones.find((m) => String(m.number) === list[1]).title;
    return { rest: [Object.keys(repo.issues).filter((n) => repo.issues[n].milestone === title && repo.issues[n].state !== 'closed').map(issue)] };
  }
  const one = /^\\/issues\\/(\\d+)$/.exec(rest);
  if (one) return { rest: issue(one[1]) };
  throw new Error('unexpected path ' + a[1]);
}`;

type Issue = {
  labels: string[];
  milestone?: string | null;
  parent?: number | string;
  state?: string;
};
type Repo = {
  archived?: boolean;
  milestones: { number: number; title: string; state: string }[];
  issues: Record<string, Issue>;
  pulls?: { number: number; body: string; linked?: number[] }[];
};

const milestones = [
  { number: 1, title: 'M037', state: 'closed' },
  { number: 2, title: 'M038', state: 'open' },
  { number: 3, title: 'M039 Next', state: 'open' },
  { number: 4, title: 'M040', state: 'open' },
];
const pbi = (milestone: string, parent?: number | string, ...extra: string[]): Issue => ({
  labels: ['pbi', ...extra],
  milestone,
  parent,
});
const feature = (milestone: string | null = null): Issue => ({ labels: ['feature'], milestone });
const empty = { features: [], cleared: [], unplanned: [], skipped: [], errors: [] };

describe('Get-Milestones.ps1 -Mode migrate', () => {
  let worker: PwshWorker;
  let tmp: string;
  let stateFile: string;
  let fake: ReturnType<typeof createFakeGh>;
  let valid: (data: unknown) => boolean;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-migrate-'));
    stateFile = path.join(tmp, 'state.json');
    fake = createFakeGh(tmp, handler);
    const schema = JSON.parse(
      fs.readFileSync(path.join(skill, 'schema/milestones.schema.json'), 'utf8'),
    );
    valid = new Ajv2020({ strict: false }).compile(schema);
  });
  afterAll(() => worker.close());

  const load = (repos: Record<string, Repo>) =>
    fs.writeFileSync(stateFile, JSON.stringify({ repos }));
  const run = async (extra: string[] = ['-Repo', 'o/r'], fail = '') => {
    const before = fake.calls().length;
    const r = await worker.run(['-Mode', 'migrate', ...extra], {
      cwd: tmp,
      env: { ...fake.env(), FAKE_STATE: stateFile, FAKE_FAIL: fail },
    });
    const calls = fake.calls().slice(before);
    const writes = calls
      .filter((c) => c.args[0] === 'issue' && c.args[1] === 'edit')
      .map((c) => `${c.args[2]} ${c.args[3] === '--milestone' ? c.args[4] : 'none'}`);
    return { r, writes, calls, out: JSON.parse(r.stdout) };
  };

  const base: Repo = {
    milestones,
    issues: {
      1: feature(),
      2: pbi('M038', 1),
      3: pbi('M039 Next', 1),
      4: { labels: ['bug'], milestone: 'M038' },
      5: pbi('M038', undefined, 'release-test'),
      // keeps its later milestone
      6: feature('M040'),
      7: pbi('M038', 6),
      // moves from an earlier one
      8: feature('M038'),
      9: pbi('M039 Next', 8),
      // parent in another repository, parent that is no Feature, closed issue, closed milestone
      10: pbi('M038', 'https://api.github.com/repos/o/other/issues/1'),
      11: pbi('M039 Next', 12),
      12: { labels: ['epic'] },
      13: { ...pbi('M038', 1), state: 'closed' },
      14: pbi('M037', 1),
    },
  };
  const expected = {
    features: [
      { number: 1, from: null, to: 'M039 Next' },
      { number: 8, from: 'M038', to: 'M039 Next' },
    ],
    cleared: [
      { number: 2, from: 'M038', feature: 1 },
      { number: 3, from: 'M039 Next', feature: 1 },
      { number: 7, from: 'M038', feature: 6 },
      { number: 9, from: 'M039 Next', feature: 8 },
    ],
    unplanned: [
      { number: 4, from: 'M038' },
      { number: 10, from: 'M038' },
      { number: 11, from: 'M039 Next' },
    ],
    skipped: [],
    errors: [],
  };

  it('-DryRun reports the plan and writes nothing; a run writes it; a rerun is a no-op', async () => {
    load({ 'o/r': base });
    const dry = await run(['-Repo', 'o/r', '-DryRun']);
    expect(dry.r.status).toBe(0);
    expect(dry.out).toEqual({ repo: 'o/r', dryRun: true, ...expected });
    expect(dry.writes).toEqual([]);
    expect(valid(dry.out)).toBe(true);

    const real = await run();
    expect(real.out).toEqual({ repo: 'o/r', dryRun: false, ...expected });
    // Features first, so a PBI is only cleared once its Feature carries the milestone
    expect(real.writes).toEqual([
      '1 M039 Next',
      '8 M039 Next',
      ...[2, 3, 4, 7, 9, 10, 11].map((n) => `${n} none`),
    ]);

    const again = await run();
    expect(again.out).toEqual({ repo: 'o/r', dryRun: false, ...empty });
    expect(again.writes).toEqual([]);
  });

  it.each([
    ['an agent:* label', { labels: ['pbi', 'agent:review'] }, [], /#3 is labeled agent:review/],
    [
      'a closing keyword of an open PR into release/next',
      {},
      [{ number: 90, body: 'Closes #3' }],
      /PR #90 into release\/next closes #3/,
    ],
    [
      'a linked issue of such a PR',
      {},
      [{ number: 91, body: 'Closes o/other#3', linked: [3] }],
      /PR #91/,
    ],
  ])('skips a milestone in flight (%s)', async (_c, change, pulls, reason) => {
    load({
      'o/r': {
        milestones,
        pulls,
        issues: {
          1: feature(),
          // below the Feature that would move into the in-flight milestone: stays for a later run
          2: pbi('M038', 1),
          3: { ...pbi('M039 Next', 1), ...change },
          4: { labels: ['bug'], milestone: 'M038' },
          5: feature('M040'),
          6: pbi('M038', 5),
        },
      },
    });
    const { r, out, writes } = await run();
    expect(r.status).toBe(0);
    expect(out.skipped).toEqual([
      { milestone: 'M039 Next', reason: expect.stringMatching(reason) },
      { milestone: 'M038', reason: expect.stringMatching(/#2 stays: .* M039 Next/) },
    ]);
    expect(writes).toEqual(['4 none', '6 none']);
    expect(valid(out)).toBe(true);
  });

  it('a Feature that cannot be moved keeps its PBIs; errors[] and exit 1', async () => {
    load({ 'o/r': base });
    const { r, out, writes } = await run(['-Repo', 'o/r'], '1,4');
    expect(r.status).toBe(1);
    expect(out.errors).toEqual([
      expect.stringContaining('Feature #1'),
      expect.stringContaining('#4'),
    ]);
    expect(out.cleared.map((x: { number: number }) => x.number)).toEqual([7, 9]);
    expect(writes).not.toContain('2 none');
    expect(valid(out)).toBe(true);
  });

  it('skips an archived repository', async () => {
    load({ 'o/r': { ...base, archived: true } });
    const { r, out, writes } = await run();
    expect(r.status).toBe(0);
    expect(out.skipped).toEqual([{ milestone: null, reason: 'archived repository' }]);
    expect(writes).toEqual([]);
  });

  it('-AllRepos: one result per non-archived repository with open milestones, a failing one does not stop the others', async () => {
    const one = (): Repo => ({ milestones, issues: { 1: pbi('M038') } });
    load({
      'o/bad': { milestones, issues: { 2: pbi('M038') } },
      'o/r': one(),
      'o/old': { ...one(), archived: true },
      'o/none': { milestones: [], issues: {} },
    });
    const { r, out, writes, calls } = await run(['-AllRepos', '-Owner', 'o'], '2');
    expect(r.status).toBe(1);
    expect(out.repos.map((x: { repo: string }) => x.repo)).toEqual(['o/bad', 'o/r']);
    expect(out.repos[0].errors).toHaveLength(1);
    expect(out.repos[1].unplanned).toEqual([{ number: 1, from: 'M038' }]);
    expect(writes).toEqual(['2 none', '1 none']);
    expect(calls.find((c) => c.args[1] === 'list')?.args).toContain('--no-archived');
    expect(valid(out)).toBe(true);
  });
});
