import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const skill = path.join(root, 'skills/github/github-milestone');
const script = path.join(skill, 'scripts/Get-Milestones.ps1');

// #113: Get-Milestones.ps1 against a fake gh that answers the REST GET paths from FAKE_* env JSON.
// --paginate --slurp: the fake answers one page wrapped in an array of pages.
const handler = `(call, ctx) => {
  const env = (k, d) => JSON.parse(process.env[k] || d);
  const [, p] = call.args;
  if (call.args.includes('-X')) {
    const title = call.args[call.args.indexOf('-f') + 1].replace(/^title=/, '');
    return { rest: { number: 99, title, state: 'open', html_url: 'https://x/m/99' } };
  }
  if (!call.args.includes('--paginate') || !call.args.includes('--slurp')) throw new Error('not paginated: ' + p);
  let page;
  if (p.includes('/milestones?')) page = env('FAKE_MILESTONES', '[]');
  else if (p.includes('/tags?')) page = env('FAKE_TAGS', '[]').map((name) => ({ name }));
  else if (p.includes('/issues?') && env('FAKE_ISSUE_PAGES', '{}')[/milestone=(\\d+)/.exec(p)[1]]) {
    const wanted = /state=(\\w+)/.exec(p)[1];
    return { rest: env('FAKE_ISSUE_PAGES', '{}')[/milestone=(\\d+)/.exec(p)[1]].map((pg) => pg.filter((i) => wanted === 'all' || i.state === wanted)) };
  }
  else if (p.includes('/issues?')) page = env('FAKE_ISSUES', '{}')[/milestone=(\\d+)/.exec(p)[1]] || [];
  else if (p.includes('/dependencies/blocked_by')) page = env('FAKE_BLOCKERS', '{}')[/issues\\/(\\d+)\\//.exec(p)[1]] || [];
  else throw new Error('unexpected path ' + p);
  return { rest: [page] };
}`;

const ms = (number: number, title: string, state = 'open', open = 0, closed = 0) => ({
  number,
  title,
  state,
  open_issues: open,
  closed_issues: closed,
  due_on: null,
  html_url: `https://x/m/${number}`,
});
const issue = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `issue ${number}`,
  labels: [],
  assignees: [],
  repository_url: 'https://api.github.com/repos/o/r',
  ...extra,
});

describe('Get-Milestones.ps1', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  let stub: string;
  let stubNull: string;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-'));
    fake = createFakeGh(tmp, handler);
    stub = path.join(tmp, 'release-state.ps1');
    fs.writeFileSync(stub, `'{"releasePr":{"number":84,"url":"https://x/pull/84"}}'\n`);
    stubNull = path.join(tmp, 'release-state-null.ps1');
    fs.writeFileSync(stubNull, `'{"releasePr":null}'\n`);
  });
  afterAll(() => worker.close());

  const run = (args: string[], env: Record<string, unknown> = {}, releaseState = stubNull) =>
    worker.run([...args, '-ReleaseState', releaseState], {
      cwd: tmp,
      env: {
        ...fake.env(),
        ...Object.fromEntries(Object.entries(env).map(([k, v]) => [k, JSON.stringify(v)])),
      },
    });
  const json = async (args: string[], env: Record<string, unknown> = {}, releaseState?: string) => {
    const r = await run(args, env, releaseState);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };

  describe('current', () => {
    it.each([
      {
        case: 'lowest open semver above the latest tag',
        tags: ['v1.0.0', 'v1.1.0', 'latest'],
        milestones: [ms(3, '1.3.0'), ms(2, '1.2.0'), ms(1, '1.1.0', 'closed'), ms(4, 'Backlog')],
        expected: '1.2.0',
      },
      {
        case: 'tag gap: an open milestone below the latest tag is stale',
        tags: ['v1.0.0', 'v1.2.0'],
        milestones: [ms(1, '1.1.0'), ms(2, '1.3.0'), ms(3, '1.4.0')],
        expected: '1.3.0',
      },
      {
        case: 'no tags yet',
        tags: [],
        milestones: [ms(1, '0.2.0'), ms(2, '0.1.0')],
        expected: '0.1.0',
      },
    ])('$case', async ({ tags, milestones, expected }) => {
      const out = await json(['-Mode', 'current'], {
        FAKE_TAGS: tags,
        FAKE_MILESTONES: milestones,
      });
      expect(out.current.title).toBe(expected);
    });

    it('none open above the latest tag: current null with a hint; a non-semver title is never current', async () => {
      const out = await json(['-Mode', 'current'], {
        FAKE_TAGS: ['v1.1.0'],
        FAKE_MILESTONES: [ms(1, '1.1.0', 'closed'), ms(2, '1.0.9'), ms(3, 'Backlog')],
      });
      expect(out).toMatchObject({ latestTag: 'v1.1.0', current: null });
      expect(out.hint).toContain('create');
    });

    it('groups the open issues, filters PRs, lists open blockers and the release PR', async () => {
      const out = await json(
        ['-Mode', 'current'],
        {
          FAKE_TAGS: ['v1.1.0'],
          FAKE_MILESTONES: [ms(7, '1.2.0', 'open', 6, 2)],
          FAKE_ISSUES: {
            7: [
              issue(10),
              issue(11, { issue_dependencies_summary: { blocked_by: 0 } }),
              issue(12),
              issue(13, { labels: [{ name: 'needs-decision' }] }),
              issue(14, { labels: [{ name: 'needs-refinement' }, { name: 'pbi' }] }),
              issue(15, { assignees: [{ login: 'jk' }] }),
              issue(16, { pull_request: { url: 'u' } }),
            ],
          },
          FAKE_BLOCKERS: {
            10: [{ number: 5, title: 'closed blocker', state: 'closed' }],
            12: [
              {
                number: 10,
                title: 'issue 10',
                state: 'open',
                repository_url: 'https://api.github.com/repos/o/r',
              },
              {
                number: 117,
                title: 'nightly sync',
                state: 'open',
                repository_url: 'https://api.github.com/repos/o/ci',
              },
              { number: 6, title: 'gone', state: 'closed' },
            ],
          },
        },
        stub,
      );
      const c = out.current;
      expect(c).toMatchObject({
        title: '1.2.0',
        open: 6,
        closed: 2,
        progress: 25,
        releasePr: { number: 84 },
      });
      const nrs = (g: { number: number }[]) => g.map((i) => i.number);
      expect(nrs(c.issues.ready)).toEqual([10, 11]);
      expect(c.issues.blocked).toEqual([
        {
          number: 12,
          title: 'issue 12',
          assignees: [],
          // a blocker of another repository keeps owner/repo (o/ci#117 is not the local #117)
          blockers: [
            { number: 10, title: 'issue 10' },
            { number: 117, title: 'nightly sync', repository: 'o/ci' },
          ],
        },
      ]);
      expect(nrs(c.issues.needsDecision)).toEqual([13]);
      expect(nrs(c.issues.needsRefinement)).toEqual([14]);
      expect(c.issues.claimed).toEqual([{ number: 15, title: 'issue 15', assignees: ['jk'] }]);
      // read-only: GET calls only; the dependency summary of #11 saves its blocked_by call
      const calls = fake.calls().map((x) => x.args);
      expect(calls.every((a) => a[0] === 'api' && !a.includes('-X'))).toBe(true);
      expect(calls.some((a) => a[1].includes('issues/11/'))).toBe(false);
    });
  });

  it('list: open and closed, semver order, non-semver last, progress and the tag flag', async () => {
    const out = await json(['-Mode', 'list'], {
      FAKE_TAGS: ['v1.0.0', 'v1.10.0'],
      FAKE_MILESTONES: [
        ms(1, '1.10.0', 'closed', 0, 4),
        ms(2, 'Backlog', 'open', 2, 0),
        ms(3, '1.2.0', 'open', 1, 3),
        ms(4, '1.0.0', 'closed'),
      ],
    });
    expect(out.latestTag).toBe('v1.10.0');
    expect(
      out.milestones.map(
        (m: { title: string; state: string; progress: number; tagged: boolean }) => [
          m.title,
          m.state,
          m.progress,
          m.tagged,
        ],
      ),
    ).toEqual([
      ['1.0.0', 'closed', 0, true],
      ['1.2.0', 'open', 75, false],
      ['1.10.0', 'closed', 100, true],
      ['Backlog', 'open', 0, false],
    ]);
  });

  describe('show', () => {
    it('one milestone by name, also a closed or non-semver one', async () => {
      const out = await json(['-Mode', 'show', '-Name', 'Backlog'], {
        FAKE_MILESTONES: [ms(2, 'Backlog')],
        FAKE_ISSUES: { 2: [issue(20)] },
      });
      expect(out).toMatchObject({ title: 'Backlog', tagged: false, releasePr: null });
      expect(out.issues.ready.map((i: { number: number }) => i.number)).toEqual([20]);
    });

    it('unknown name: exit 1 with a message', async () => {
      const r = await run(['-Mode', 'show', '-Name', '9.9.9'], {
        FAKE_MILESTONES: [ms(1, '1.0.0')],
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("milestone '9.9.9' not found");
    });
  });

  describe('issues (#127)', () => {
    const full = (number: number, extra: Record<string, unknown> = {}) =>
      issue(number, {
        state: 'open',
        body: `body ${number}`,
        labels: [{ name: 'pbi' }],
        assignees: [{ login: 'me' }],
        ...extra,
      });

    it('resolves the title to its number and lists all pages in one paginated call, PRs filtered out', async () => {
      const out = await json(['-Mode', 'issues', '-Name', '1.2.0'], {
        FAKE_MILESTONES: [ms(1, '1.1.0'), ms(7, '1.2.0')],
        FAKE_ISSUE_PAGES: {
          7: [
            [full(12), full(11, { pull_request: {} })],
            [
              full(13, {
                state: 'closed',
                closed_at: '2026-10-01T10:00:00Z',
                labels: [{ name: 'bug' }],
                assignees: [],
              }),
            ],
          ],
        },
      });
      expect(out.milestone).toEqual({ number: 7, title: '1.2.0', state: 'open' });
      expect(out.issues).toEqual([
        {
          number: 12,
          title: 'issue 12',
          state: 'open',
          closed_at: null,
          body: 'body 12',
          labels: ['pbi'],
          assignees: ['me'],
        },
        {
          number: 13,
          title: 'issue 13',
          state: 'closed',
          closed_at: '2026-10-01T10:00:00Z',
          body: 'body 13',
          labels: ['bug'],
          assignees: [],
        },
      ]);
      const paths = fake.calls().map((c) => c.args[1]);
      expect(paths.filter((q) => q.includes('/issues?'))).toContain(
        'repos/{owner}/{repo}/issues?milestone=7&state=all&per_page=100',
      );
    });

    it.each([
      ['open', [12]],
      ['closed', [13]],
      ['all', [12, 13]],
    ])('-State %s', async (state, expected) => {
      const out = await json(['-Mode', 'issues', '-Name', '1.2.0', '-State', state], {
        FAKE_MILESTONES: [ms(7, '1.2.0')],
        FAKE_ISSUE_PAGES: { 7: [[full(12), full(13, { state: 'closed' })]] },
      });
      expect(out.issues.map((i: { number: number }) => i.number)).toEqual(expected);
    });

    it('unknown milestone: exit 1 with a message', async () => {
      const r = await run(['-Mode', 'issues', '-Name', '9.9.9'], {
        FAKE_MILESTONES: [ms(1, '1.0.0')],
      });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("milestone '9.9.9' not found");
    });
  });

  describe('create', () => {
    it.each([
      { name: '1.2.0', existing: [ms(5, '1.2.0', 'closed')], created: false, number: 5 },
      { name: 'v1.3.0', existing: [ms(5, '1.2.0')], created: true, number: 99 },
    ])('$name: created $created', async ({ name, existing, created, number }) => {
      const before = fake.calls().length;
      const out = await json(['-Mode', 'create', '-Name', name], { FAKE_MILESTONES: existing });
      expect(out).toMatchObject({ created, milestone: { number, title: name.replace(/^v/, '') } });
      const posts = fake
        .calls()
        .slice(before)
        .filter((c) => c.args.includes('-X'));
      expect(posts.map((c) => c.args)).toEqual(
        created
          ? [['api', '-X', 'POST', 'repos/{owner}/{repo}/milestones', '-f', 'title=1.3.0']]
          : [],
      );
    });

    it('invalid name: exit 1, nothing created', async () => {
      const before = fake.calls().length;
      const r = await run(['-Mode', 'create', '-Name', 'next'], { FAKE_MILESTONES: [] });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("invalid milestone name 'next'");
      expect(
        fake
          .calls()
          .slice(before)
          .some((c) => c.args.includes('-X')),
      ).toBe(false);
    });
  });
});
