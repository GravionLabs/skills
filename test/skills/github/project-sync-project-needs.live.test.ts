import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const itemNr = (c: { args: string[] }) => Number(c.args[3].split('/').pop());
const restPath = (c: { args: string[] }) =>
  c.args.find((a) => /^(users|orgs|repos)\//.test(a)) ?? '';
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/github/github-project/scripts/Sync-ProjectNeeds.ps1',
);

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const hasNode = spawnSync('node', ['-v']).status === 0;

it('pwsh is installed in CI (the live Sync-ProjectNeeds cases must not be skipped there)', () => {
  if (process.env.CI) expect(hasPwsh).toBe(true);
});

// Canned REST answers (the script reads and writes through REST only).
// data.json: {items (REST project items), subIssues/blockedBy/blocking ({"o/r#n": list}), issueTypes ({"o/r#n": name}),
//   prs ({"o/r": [head refs]}), ownerType, noNeeds, noStatusOption, noProject, failMutation}.
const FIELDS = (d: any) => [
  ...(d.onlyNeeds
    ? []
    : [
        {
          id: 101,
          name: 'Status',
          data_type: 'single_select',
          options: d.noStatusOption
            ? [{ id: 'O-todo', name: { raw: 'Todo' } }]
            : [
                { id: 'O-todo', name: { raw: 'Todo' } },
                { id: 'O-ip', name: { raw: 'In Progress' } },
                { id: 'O-done', name: { raw: 'Done' } },
              ],
        },
      ]),
  ...(d.onlyNeeds ? [] : [{ id: 102, name: 'Level', data_type: 'single_select', options: [] }]),
  ...(d.noNeeds
    ? []
    : [
        {
          id: 103,
          name: 'Needs',
          data_type: 'single_select',
          options: [
            'Planning',
            'Ready',
            'In progress',
            'Blocked',
            'Review',
            'Decision',
            'Release review',
          ].map((n) => ({ id: 'O-' + n, name: { raw: n } })),
        },
      ]),
  ...(d.withCurrent
    ? [
        {
          id: 106,
          name: 'Current',
          data_type: 'single_select',
          options: [{ id: 'O-yes', name: { raw: 'Yes' } }],
        },
      ]
    : []),
  ...(d.onlyNeeds
    ? []
    : [
        { id: 104, name: 'Parent issue', data_type: 'parent_issue', options: null },
        { id: 105, name: 'Linked pull requests', data_type: 'linked_pull_requests', options: null },
      ]),
];
const HANDLER = `(call, ctx) => {
  const fs = require('fs');
  const d = JSON.parse(fs.readFileSync(process.env.FAKE_DATA, 'utf8'));
  const FIELDS = ${FIELDS.toString()};
  const path = call.args.find((a) => /^(users|orgs|repos)\\//.test(a)) || '';
  const slurp = call.args.includes('--slurp');
  const list = (all) => slurp ? Array.from({ length: Math.max(1, Math.ceil(all.length / 100)) }, (_, i) => all.slice(i * 100, i * 100 + 100)) : all;
  const key = (p, re) => { const m = p.match(re); return m[1] + '#' + m[2]; };
  if (call.args.includes('PATCH')) {
    if (d.archivedItem && call.args.some((a) => a.endsWith('/items/' + d.archivedItem))) throw new Error('HTTP 422: The item is archived and cannot be updated');
    if (d.failMutation && ctx.count('mut') <= d.failMutation) throw new Error('secondary rate limit');
    return { rest: {} };
  }
  if (path === 'users/o') return { rest: { login: 'o', type: d.ownerType || 'User' } };
  if (/^(users|orgs)\\/o\\/projectsV2\\/1$/.test(path)) {
    if (d.noProject) throw new Error('HTTP 404: Not Found');
    return { rest: { id: 99, number: 1 } };
  }
  if (path.includes('/projectsV2/1/fields')) return { rest: list(FIELDS(d)) };
  if (path.includes('/projectsV2/1/items')) {
    const q = (path.match(/[?&]q=repo:([^&]+)/) || [])[1];
    const all = d.items.filter((i) => !q || !i.content || i.content.repository.full_name === q);
    return { rest: list(all) };
  }
  if (path.startsWith('users/o/repos')) return { rest: list(d.repos || []) };
  let m;
  if ((m = path.match(/^repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)\\/(sub_issues|dependencies\\/blocked_by|dependencies\\/blocking)/))) {
    const map = { sub_issues: d.subIssues, 'dependencies/blocked_by': d.blockedBy, 'dependencies/blocking': d.blocking }[m[3]] || {};
    const dflt = m[3] === 'sub_issues' ? [{ number: 100, title: '[Task] x' }] : [];
    return { rest: list(map[m[1] + '#' + m[2]] || dflt) };
  }
  if ((m = path.match(/^repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)$/))) {
    const t = (d.issueTypes || {})[m[1] + '#' + m[2]];
    return { rest: { number: Number(m[2]), type: t ? { name: t } : null } };
  }
  if ((m = path.match(/^repos\\/([^/]+\\/[^/]+)\\/milestones/))) {
    return { rest: list(((d.milestones || {})[m[1]] || []).map((t) => ({ title: t }))) };
  }
  if ((m = path.match(/^repos\\/([^/]+\\/[^/]+)\\/tags/))) {
    return { rest: list(((d.tags || {})[m[1]] || []).map((n) => ({ name: n }))) };
  }
  if ((m = path.match(/^repos\\/([^/]+\\/[^/]+)\\/pulls/))) {
    return { rest: list(((d.prs || {})[m[1]] || []).map((h) => ({ head: { ref: h } }))) };
  }
  throw new Error('unexpected call ' + call.args.join(' '));
}`;

const URL = 'https://api.github.com/repos/';
// a REST project item; fields carry Status (101), Level (102), Needs (103), Parent issue (104), Linked pull requests (105)
const restItem = (nr: number, needs: string | null, o: Record<string, any> = {}) => ({
  id: nr,
  node_id: `PVTI_${nr}`,
  content_type: 'Issue',
  content: {
    number: nr,
    state: 'open',
    title: '[PBI] t',
    labels: [],
    repository: { full_name: o.repo ?? 'o/r' },
    repository_url: URL + (o.repo ?? 'o/r'),
    sub_issues_summary: { total: 1 },
    issue_dependencies_summary: {
      blocked_by: 0,
      total_blocked_by: 0,
      blocking: 0,
      total_blocking: 0,
    },
    ...o.content,
  },
  fields: [
    {
      id: 101,
      name: 'Status',
      value: o.status === null ? null : { name: { raw: o.status ?? 'Todo' } },
    },
    {
      id: 102,
      name: 'Level',
      value: o.level === null ? null : { name: { raw: o.level ?? 'PBI' } },
    },
    { id: 103, name: 'Needs', value: needs ? { name: { raw: needs } } : null },
    {
      id: 104,
      name: 'Parent issue',
      value: o.parent
        ? { number: o.parent.number, repository_url: URL + (o.parent.repo ?? 'o/r') }
        : null,
    },
    { id: 105, name: 'Linked pull requests', value: o.linked ?? [] },
    ...(o.current !== undefined
      ? [{ id: 106, name: 'Current', value: o.current ? { name: { raw: o.current } } : null }]
      : []),
  ],
});
// Cases that do not test the sub-issue read: no sub-issues and the label planned give the same Ready as one Task sub-issue, without the gh call.
const planned = { sub_issues_summary: { total: 0 }, labels: [{ name: 'planned' }] };
const dep = (nr: number, repo = 'o/r', state = 'open', labels: string[] = []) => ({
  number: nr,
  state,
  labels: labels.map((name) => ({ name })),
  repository_url: URL + repo,
});

describe.skipIf(!hasPwsh || !hasNode || process.platform === 'win32')(
  'Sync-ProjectNeeds live mode',
  () => {
    let worker: PwshWorker;
    let tmp: string;
    beforeAll(() => {
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(() => worker.close());
    beforeEach(() => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'needs-live-'));
    });
    afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

    const run = async (
      data: Record<string, any>,
      args: string[] = [],
      env: Record<string, string> = {},
    ) => {
      const gh = createFakeGh(tmp, HANDLER);
      const dataFile = path.join(tmp, 'data.json');
      fs.writeFileSync(dataFile, JSON.stringify({ prs: {}, items: [], ...data }));
      const r = await worker.run(['-Owner', 'o', '-Number', '1', ...args], {
        cwd: tmp,
        env: {
          ...gh.env(),
          FAKE_DATA: dataFile,
          SYNC_PROJECT_NEEDS_BACKOFF: '0',
          ...env,
        },
      });
      const calls = gh.calls();
      return {
        r,
        calls,
        itemCalls: calls.filter(
          (c) => restPath(c).includes('/projectsV2/1/items') && !c.args.includes('PATCH'),
        ),
        mutations: calls.filter((c) => c.args.includes('PATCH')),
        paths: calls.map(restPath),
      };
    };

    it('reads 101 items of an organization project that has only the field Needs (no Status, Level, Parent issue, Linked pull requests) through REST in one paginated call and mutates only the changed ones', async () => {
      // 101 items cross the page boundary (100); 100 are closed without Needs (unchanged), 1 open PBI with a Task sub-issue -> Ready.
      const items = Array.from({ length: 101 }, (_, i) =>
        restItem(i + 1, null, i < 100 ? { content: { state: 'closed' } } : {}),
      );
      const { r, calls, itemCalls, mutations } = await run({
        onlyNeeds: true,
        ownerType: 'Organization',
        items,
      });
      expect(r.stdout).toContain('#101: (none) -> Ready');
      expect(r.stdout).toContain('Needs: 1 changed, 100 unchanged');
      expect(r.status).toBe(0);
      expect(itemCalls).toHaveLength(1);
      expect(itemCalls[0].args).toEqual(expect.arrayContaining(['--paginate', '--slurp']));
      expect(restPath(itemCalls[0])).toMatch(
        /^orgs\/o\/projectsV2\/1\/items\?per_page=100&fields\[\]=103$/,
      );
      expect(mutations).toHaveLength(1);
      expect(mutations[0].args).toEqual([
        'api',
        '-X',
        'PATCH',
        'orgs/o/projectsV2/1/items/101',
        '--input',
        '-',
      ]);
      expect(mutations[0].body).toEqual({ fields: [{ id: 103, value: 'O-Ready' }] });
      expect(calls.some((c) => c.args.includes('graphql'))).toBe(false);
    });

    describe('field Current (#167)', () => {
      const msItem = (
        nr: number,
        milestone: string | null,
        current: string | null,
        state = 'open',
        repo = 'o/r',
      ) =>
        restItem(nr, state === 'open' ? 'Ready' : null, {
          repo,
          current,
          content: { ...planned, state, milestone: milestone ? { title: milestone } : null },
        });

      it('reads milestones once per repository via REST and the tags only when a legacy x.y.z milestone is open, writes only the changed items, adds no GraphQL call', async () => {
        const { r, calls, mutations } = await run({
          withCurrent: true,
          milestones: { 'o/r': ['M10', 'M2'], 'o/x': ['1.2.0', 'M1'] },
          tags: { 'o/x': ['v1.2.0', 'v1.1.0'] },
          items: [
            msItem(1, 'M2', null),
            msItem(2, 'M2', 'Yes'),
            msItem(3, 'M10', 'Yes'),
            msItem(4, 'M2', null, 'closed'),
            msItem(5, 'M1', null, 'open', 'o/x'),
            msItem(6, '1.2.0', null, 'open', 'o/x'),
          ],
        });
        expect(r.status).toBe(0);
        const ms = calls.filter((c) => restPath(c).includes('/milestones'));
        expect(ms.map(restPath)).toEqual([
          'repos/o/r/milestones?state=open&per_page=100',
          'repos/o/x/milestones?state=open&per_page=100',
        ]);
        // tags: only o/x has a legacy milestone open
        expect(calls.filter((c) => restPath(c).includes('/tags')).map(restPath)).toEqual([
          'repos/o/x/tags?per_page=100',
        ]);
        expect(calls.some((c) => c.args.includes('graphql'))).toBe(false);
        expect(mutations.map((m) => [m.args[3], m.body])).toEqual([
          ['users/o/projectsV2/1/items/1', { fields: [{ id: 106, value: 'O-yes' }] }],
          ['users/o/projectsV2/1/items/3', { fields: [{ id: 106, value: null }] }],
          ['users/o/projectsV2/1/items/4', { fields: [{ id: 106, value: 'O-yes' }] }],
          ['users/o/projectsV2/1/items/5', { fields: [{ id: 106, value: 'O-yes' }] }],
        ]);
        expect(r.stdout).toContain('#3: Current Yes -> (clear)');
      });
    });

    it('fails with a clear message when the item has no database id', async () => {
      const { r } = await run({
        items: [{ ...restItem(4, null, { content: planned }), id: null }],
      });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('Needs sync failed');
      expect(r.stdout).toContain('has no databaseId');
    });

    it('-Issue with a bare number and no -Repo fails with one line and exit 1', async () => {
      const { r, mutations } = await run({}, ['-Issue', '7']);
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('Needs sync failed:');
      expect(mutations).toHaveLength(0);
    });

    it('a bare -Issue number takes the repository from the origin remote of the checkout; -DryRun prints the change and sends no mutation', async () => {
      spawnSync('git', ['init', '-q'], { cwd: tmp });
      spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:o/r.git'], { cwd: tmp });
      const { r, mutations, itemCalls } = await run(
        {
          items: [
            restItem(7, null, { content: planned }),
            restItem(9, null),
            restItem(5, null, { repo: 'o/x' }),
          ],
        },
        ['-Issue', '7', '-DryRun'],
      );
      expect(restPath(itemCalls[0])).toContain('&q=repo:o/r');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('#7: (none) -> Ready');
      expect(r.stdout).toContain('Needs: 1 to change, 0 unchanged (dry run)');
      expect(mutations).toHaveLength(0);
    });

    describe('-SetStatus', () => {
      const setStatus = (data: Record<string, any>, extra: string[] = []) =>
        run(data, ['-Issue', 'o/r#7', '-SetStatus', 'In Progress', ...extra]);

      it('sets the option with one REST update on the Status field', async () => {
        const { r, mutations, calls } = await setStatus({ items: [restItem(7, null)] });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('#7: Status -> In Progress');
        expect(mutations).toHaveLength(1);
        expect(mutations[0].args[3]).toBe('users/o/projectsV2/1/items/7');
        expect(mutations[0].body).toEqual({ fields: [{ id: 101, value: 'O-ip' }] });
        expect(calls.some((c) => c.args.includes('graphql'))).toBe(false);
      });

      it.each([
        [
          'a missing option is a note',
          { noStatusOption: true },
          [],
          "option 'In Progress' missing",
        ],
        ['an issue outside the project is a note', {}, [], '#7 is not in the project'],
      ])('%s and exit 0, no mutation', async (_n, extra, items, text) => {
        const { r, mutations } = await setStatus({ items, ...extra });
        expect(r.status).toBe(0);
        expect(r.stdout).toContain(text);
        expect(mutations).toHaveLength(0);
      });

      it('-DryRun sends no mutation', async () => {
        const { r, mutations } = await setStatus({ items: [restItem(7, null)] }, ['-DryRun']);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('#7: Status -> In Progress (dry run)');
        expect(mutations).toHaveLength(0);
      });

      it('a failing update exits 1 with a Status not set line', async () => {
        const { r } = await setStatus({ items: [restItem(7, null)], failMutation: 99 });
        expect(r.status).toBe(1);
        expect(r.stdout).toContain('Status not set:');
      });
    });

    describe('project-wide sync (no -Repo, no -Issue)', () => {
      const blockedByOne = {
        content: {
          issue_dependencies_summary: {
            blocked_by: 1,
            total_blocked_by: 1,
            blocking: 0,
            total_blocking: 0,
          },
        },
      };
      const items = () => [
        restItem(1, null),
        restItem(2, null, { repo: 'o/x', content: planned }),
        restItem(3, null, { repo: 'o/x', content: { ...blockedByOne.content, ...planned } }),
        restItem(4, 'Ready', { repo: 'o/y' }),
        restItem(5, 'Ready', { repo: 'o/y', content: { state: 'closed' } }),
        // PR heads, blocked-by links and linked pull requests of o/r
        restItem(7, null, { content: { sub_issues_summary: { total: 0 } } }),
        restItem(8, null, {
          content: { ...blockedByOpen(1, 2).content, sub_issues_summary: { total: 0 } },
        }),
        restItem(9, null, { content: { ...blockedByOpen(0, 1).content, ...planned } }),
        restItem(10, null, {
          linked: [{ number: 5, state: 'open', head: { ref: 'x' } }],
          content: { sub_issues_summary: { total: 0 } },
        }),
        restItem(11, null, {
          linked: [{ number: 6, state: 'closed', head: { ref: 'y' } }],
          content: planned,
        }),
        // #182: a blocker blocks while open (the Status of its item plays no part); with the label merged it counts as resolved
        restItem(21, null, { content: { ...blockedByOpen(1, 1).content, ...planned } }),
      ];
      const blockedByOpen = (open: number, total: number) => ({
        content: {
          issue_dependencies_summary: {
            blocked_by: open,
            total_blocked_by: total,
            blocking: 0,
            total_blocking: 0,
          },
        },
      });
      const data = () => ({
        items: items(),
        blockedBy: {
          'o/x#3': [dep(90, 'o/x')],
          'o/r#8': [dep(90), dep(91, 'o/r', 'closed')],
          'o/r#21': [dep(30, 'o/r', 'open', ['Merged'])],
        },
        // the PR head of #1 sits in o/x only: it must not count for #1 of o/r
        prs: {
          'o/x': ['feat/2-thing', 'feat/1-other'],
          'o/r': ['feat/7-thing', 'feat/17-other'],
          'o/y': [],
        },
      });

      it('reads the items of every repository in one unfiltered call, syncs them all, matches PR heads per repository, blockers and linked pull requests', async () => {
        const { r, itemCalls, mutations, paths } = await run(data());
        expect(r.status).toBe(0);
        expect(itemCalls).toHaveLength(1);
        expect(restPath(itemCalls[0])).not.toContain('q=repo:');
        expect(r.stdout).toContain('#1: (none) -> Ready');
        expect(r.stdout).toContain('#2: (none) -> In progress');
        expect(r.stdout).toContain('#3: (none) -> Blocked');
        expect(r.stdout).toContain('#5: Ready -> (clear)');
        expect(r.stdout).toContain('#7: (none) -> In progress');
        expect(r.stdout).toContain('#8: (none) -> Blocked');
        expect(r.stdout).toContain('#9: (none) -> Ready');
        expect(r.stdout).toContain('#10: (none) -> In progress');
        expect(r.stdout).toContain('#11: (none) -> Ready');
        expect(r.stdout).toContain('#21: (none) -> Ready');
        expect(r.stdout).toContain('Needs: 10 changed, 1 unchanged');
        expect(mutations.map(itemNr).sort((a, b) => a - b)).toEqual([
          1, 2, 3, 5, 7, 8, 9, 10, 11, 21,
        ]);
        expect(paths.filter((p) => p.includes('/pulls'))).toHaveLength(3);
        expect(paths).not.toContain('repos/o/r/issues/9/dependencies/blocked_by?per_page=100');
      });
    });

    it('prints the skip line and exits 0 when the field Needs is missing', async () => {
      const { r, mutations, itemCalls } = await run({ noNeeds: true, items: [restItem(1, null)] });
      expect(r.stdout.trim()).toBe(
        'Needs sync skipped: field Needs missing (run Set-ProjectStandard.ps1, #596)',
      );
      expect(r.status).toBe(0);
      expect(itemCalls).toHaveLength(0);
      expect(mutations).toHaveLength(0);
    });

    // #182: a blocker blocks while open (the Status of its item plays no part); with the label merged it counts as resolved.
    it('-IncludeParents reads the parent in its repository; -IncludeDependents syncs open blocked issues (cross-repository ones too), outside-project ones drop out, the blocking call is gated by total_blocking', async () => {
      const blocks = (n: number) => ({
        content: {
          issue_dependencies_summary: {
            blocked_by: 0,
            total_blocked_by: 0,
            blocking: n,
            total_blocking: n,
          },
        },
      });
      const noSubs = { sub_issues_summary: { total: 0 } }; // the sub-issue read is not under test here
      const items = [
        restItem(7, null, {
          parent: { number: 3, repo: 'o/up' },
          content: { ...blocks(4).content, ...noSubs },
        }),
        restItem(3, null, {
          repo: 'o/up',
          level: 'Feature',
          content: { title: '[Feature] f', sub_issues_summary: { total: 0 } },
        }),
        restItem(8, null, { content: noSubs }),
        restItem(10, null, { repo: 'o/x', content: noSubs }),
        restItem(12, null, { content: noSubs }),
      ];
      const data = {
        items,
        blocking: { 'o/r#7': [dep(8), dep(9, 'o/r', 'closed'), dep(10, 'o/x'), dep(11)] },
      };
      const args = ['-Issue', 'o/r#7,o/r#12', '-IncludeParents', '-IncludeDependents'];
      const { r, mutations, paths, itemCalls } = await run(data, args);
      expect(r.status).toBe(0);
      expect(mutations.map(itemNr).sort((a, b) => a - b)).toEqual([3, 7, 8, 10, 12]);
      expect(r.stdout).toContain('#3: (none) -> Planning');
      expect(itemCalls.map((c) => restPath(c).match(/q=repo:(\S+)/)![1])).toEqual([
        'o/r',
        'o/up',
        'o/x',
      ]);
      expect(paths).toContain('repos/o/r/issues/7/dependencies/blocking?per_page=100');
      expect(paths.some((p) => p.includes('/issues/12/dependencies/blocking'))).toBe(false);
    });

    // One run for the Status reset and scope report (#169) and the sub-issue levels / archived items: they need no flags of their own.
    it('resets stale In Progress to Todo / Done, keeps the one with a PR, updates and clears Needs, reports items without Level; takes sub-issue levels from title, type or the Level of items already read; reads the issue type of a legacy issue; skips sub-issues of an issue without any; an item archived at the read is never planned, one archived before the write is skipped with a warning (no retry, exit 0)', async () => {
      const feature = (nr: number) =>
        restItem(nr, null, { level: 'Feature', content: { title: '[Feature] f' } });
      const sub = (nr: number, over: object = {}) => ({
        number: nr,
        title: 'plain',
        repository_url: URL + 'o/r',
        ...over,
      });
      const items = [
        // #169: stale Status, scope report
        restItem(1, 'In progress', { status: 'In Progress', content: planned }),
        restItem(2, 'In progress', { status: 'In Progress', content: planned }),
        restItem(3, null, { status: 'In Progress', content: { state: 'closed' } }),
        restItem(4, 'Ready', { level: null, content: { title: 'plain' } }),
        restItem(5, 'Ready', { content: { state: 'closed' } }),
        // sub-issue levels and archived items
        feature(11),
        feature(12),
        feature(13),
        feature(14),
        restItem(61, 'Ready'),
        restItem(16, 'Planning', { level: null, content: { title: 'plain' } }),
        restItem(18, null, { content: { sub_issues_summary: { total: 0 } } }),
        { ...restItem(19, null), archived_at: '2026-01-01T00:00:00Z' },
      ];
      const { r, paths, mutations } = await run({
        items,
        archivedItem: 14,
        repos: [
          { full_name: 'o/r', open_issues_count: 2 },
          { full_name: 'o/lonely', open_issues_count: 5 },
        ],
        prs: { 'o/r': ['feat/2-x'] },
        subIssues: {
          'o/r#11': [sub(61)],
          'o/r#12': [sub(52, { title: '[PBI] x' })],
          'o/r#13': [sub(53, { type: { name: 'PBI' } })],
          'o/r#14': [sub(54)],
          'o/r#16': [{ number: 60, title: '[Feature] f' }],
        },
        issueTypes: { 'o/r#16': 'Epic' },
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('Without Level: o/r: 2 open');
      expect(r.stderr).toContain('o/lonely');
      expect(r.stdout).toContain('#1: Status In Progress -> Todo');
      expect(r.stdout).toContain('#3: Status In Progress -> Done');
      expect(r.stdout).not.toMatch(/#1[123]:/);
      expect(r.stdout).toContain('#14: (none) -> Planning');
      expect(r.stdout).toContain('#16: Planning -> (clear)');
      expect(paths).toContain('repos/o/r/issues/16');
      expect(paths.some((p) => p.includes('/issues/18/sub_issues'))).toBe(false);
      // #19 archived at the read: not planned; #14 archived before the write: tried once, skipped; #16 and #18 still written
      expect(mutations.map((m) => [m.args[3], m.body])).toEqual([
        ['users/o/projectsV2/1/items/1', { fields: [{ id: 101, value: 'O-todo' }] }],
        ['users/o/projectsV2/1/items/1', { fields: [{ id: 103, value: 'O-Ready' }] }],
        ['users/o/projectsV2/1/items/3', { fields: [{ id: 101, value: 'O-done' }] }],
        ['users/o/projectsV2/1/items/5', { fields: [{ id: 103, value: null }] }],
        ['users/o/projectsV2/1/items/14', { fields: [{ id: 103, value: 'O-Planning' }] }],
        ['users/o/projectsV2/1/items/16', { fields: [{ id: 103, value: null }] }],
        ['users/o/projectsV2/1/items/18', { fields: [{ id: 103, value: 'O-Planning' }] }],
      ]);
      expect(r.stdout).toContain('skipped (archived): 2');
      expect(r.stderr + r.stdout).toContain('is archived and cannot be updated; skipped.');
    });

    it('exits 1 with the project scope hint when the project is not found', async () => {
      const { r } = await run({ noProject: true });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('Needs sync failed: Project o/1 not found');
      expect(r.stdout).toContain("scope 'project' missing");
    });

    it('exits 1 with one line after 4 failed tries', async () => {
      const { r, mutations } = await run({
        items: [restItem(1, null, { content: planned })],
        failMutation: 99,
      });
      expect(r.status).toBe(1);
      expect(mutations).toHaveLength(4);
      expect(r.stdout).toMatch(/Needs sync failed: Needs update failed for o\/r#1/);
    });
  },
);
