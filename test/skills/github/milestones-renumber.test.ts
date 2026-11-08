import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-milestone/scripts/Get-Milestones.ps1');

// #434: Get-Milestones.ps1 -Mode renumber against a fake gh (GET answers from FAKE_REPOS = {repo: milestones}, writes are recorded).
const handler = `(call) => {
  const a = call.args;
  const repos = JSON.parse(process.env.FAKE_REPOS);
  if (a[0] === 'repo' && a[1] === 'view') return { rest: process.env.FAKE_SELF };
  if (a[0] === 'repo' && a[1] === 'list') return { rest: Object.keys(repos).map((nameWithOwner) => ({ nameWithOwner })) };
  if (a.includes('-X')) return { rest: {} };
  const m = a[1].match(/^repos\\/(.+)\\/milestones\\?/);
  if (m) return { rest: [repos[m[1]] || []] };
  throw new Error('unexpected path ' + a[1]);
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

// the repository of the current directory (gh repo view), as -Repo is omitted
const here = 'o/r';
const mixed = [
  ms(1, 'M1 (0.2.0)', 'closed'),
  ms(2, 'M11.1'),
  ms(3, 'M12 Terminal'),
  ms(4, '0.1.0', 'closed'),
  ms(5, 'Backlog'),
  ms(6, 'M007'),
  ms(7, 'M1000 Far'),
  ms(8, 'M3.10'),
];

describe('Get-Milestones.ps1 -Mode renumber', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-renumber-'));
    fake = createFakeGh(tmp, handler);
  });
  afterAll(() => worker.close());

  const run = async (repos: Record<string, unknown[]>, extra: string[] = []) => {
    const before = fake.calls().length;
    const r = await worker.run(['-Mode', 'renumber', ...extra], {
      cwd: tmp,
      env: { ...fake.env(), FAKE_REPOS: JSON.stringify(repos), FAKE_SELF: here },
    });
    const calls = fake.calls().slice(before);
    const writes = calls.filter((c) => c.args.includes('-X')).map((c) => c.args);
    return { r, writes, calls };
  };
  const patch = (repo: string, n: number, title: string) => [
    'api',
    '-X',
    'PATCH',
    `repos/${repo}/milestones/${n}`,
    '-f',
    `title=${title}`,
  ];

  it('-DryRun prints the plan with state, old, new and a summary, and writes nothing', async () => {
    const { r, writes } = await run({ [here]: mixed }, ['-DryRun']);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j).toMatchObject({ renumbered: false, dryRun: true, error: null });
    expect(j.renames).toEqual([
      { number: 1, state: 'closed', old: 'M1 (0.2.0)', new: 'M001 (0.2.0)' },
      { number: 2, state: 'open', old: 'M11.1', new: 'M011.1' },
      { number: 3, state: 'open', old: 'M12 Terminal', new: 'M012 Terminal' },
    ]);
    expect(j.skipped.map((s: { number: number; title: string }) => [s.number, s.title])).toEqual([
      [7, 'M1000 Far'],
      [8, 'M3.10'],
    ]);
    expect(j.summary).toEqual({
      milestones: 8,
      numbered: 6,
      renames: 3,
      unchanged: 1,
      skipped: 2,
      other: 2,
    });
    expect(writes).toEqual([]);
  });

  it('renames open and closed milestones, leaves legacy, other and skipped titles', async () => {
    const { r, writes } = await run({ [here]: mixed });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ renumbered: true, dryRun: false });
    expect(writes).toEqual([
      patch(here, 1, 'M001 (0.2.0)'),
      patch(here, 2, 'M011.1'),
      patch(here, 3, 'M012 Terminal'),
    ]);
  });

  it('is idempotent: padded titles plan nothing', async () => {
    const done = [ms(1, 'M001 (0.2.0)', 'closed'), ms(2, 'M011.1'), ms(3, '0.3.0')];
    const { r, writes } = await run({ [here]: done });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      renames: [],
      skipped: [],
      summary: { renames: 0, unchanged: 2, other: 1 },
    });
    expect(writes).toEqual([]);
  });

  it.each([
    ['a target title that exists', [ms(1, 'M1'), ms(2, 'M001'), ms(3, 'M2')], /already exists/],
    ['two milestones that become the same title', [ms(1, 'M1'), ms(2, 'M01')], /both become/],
  ])('%s: exit 1 before any write', async (_c, list, msg) => {
    const { r, writes } = await run({ [here]: list });
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(msg);
    expect(writes).toEqual([]);
  });

  it('without -Repo the repo field is the owner/name of the current repository, never the placeholder', async () => {
    const { r, writes } = await run({ [here]: mixed }, ['-DryRun']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).repo).toBe('o/r');
    expect(r.stdout).not.toContain('{owner}');
    expect(writes).toEqual([]);
  });

  describe('-AllRepos', () => {
    const repos = {
      'acme/a': [ms(1, 'M1'), ms(2, 'M2 X', 'closed')],
      'acme/empty': [],
      'acme/b': [ms(9, 'M10.2')],
    };

    it('lists the owner repositories, skips those without milestones, one result per repo', async () => {
      const { r, writes, calls } = await run(repos, ['-AllRepos', '-Owner', 'acme']);
      expect(r.status).toBe(0);
      const j = JSON.parse(r.stdout);
      expect(j.allRepos).toBe(true);
      expect(
        j.repos.map((x: { repo: string; renumbered: boolean }) => [x.repo, x.renumbered]),
      ).toEqual([
        ['acme/a', true],
        ['acme/b', true],
      ]);
      expect(writes).toEqual([
        patch('acme/a', 1, 'M001'),
        patch('acme/a', 2, 'M002 X'),
        patch('acme/b', 9, 'M010.2'),
      ]);
      const list = calls.find((c) => c.args[0] === 'repo' && c.args[1] === 'list');
      expect(list?.args).toEqual(
        expect.arrayContaining(['acme', '--json', 'nameWithOwner', '--no-archived']),
      );
    });

    it('-DryRun writes nothing; a clash in one repo aborts all writes', async () => {
      const dry = await run(repos, ['-AllRepos', '-Owner', 'acme', '-DryRun']);
      expect(dry.r.status).toBe(0);
      expect(JSON.parse(dry.r.stdout).repos).toHaveLength(2);
      expect(dry.writes).toEqual([]);
      const bad = await run({ ...repos, 'acme/c': [ms(1, 'M5'), ms(2, 'M005')] }, [
        '-AllRepos',
        '-Owner',
        'acme',
      ]);
      expect(bad.r.status).toBe(1);
      expect(bad.r.stderr).toMatch(/acme\/c/);
      expect(bad.writes).toEqual([]);
    });
  });
});
