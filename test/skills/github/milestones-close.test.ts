import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-milestone/scripts/Get-Milestones.ps1');

// #206: Get-Milestones.ps1 -Mode close against a fake gh (REST GET answers from FAKE_* env JSON, writes are recorded).
const handler = `(call) => {
  const env = (k, d) => JSON.parse(process.env[k] || d);
  const a = call.args;
  const fail = env('FAKE_FAIL', '{}');
  if (a[0] === 'issue') {
    if (fail.edit === a[2]) throw new Error('edit failed');
    return { rest: {} };
  }
  if (a.includes('-X')) {
    if (fail.patch) throw new Error('patch failed');
    return { rest: {} };
  }
  const p = a[1];
  if (p.includes('/git/ref/tags/')) {
    const tag = p.split('/git/ref/tags/')[1];
    if (!env('FAKE_TAGS', '[]').includes(tag)) throw new Error('Not Found (HTTP 404)');
    return { rest: { ref: 'refs/tags/' + tag } };
  }
  if (p.includes('/tags?')) return { rest: [env('FAKE_TAGS', '[]').map((name) => ({ name }))] };
  if (!a.includes('--paginate') || !a.includes('--slurp')) throw new Error('not paginated: ' + p);
  if (p.includes('/milestones?')) return { rest: [env('FAKE_MILESTONES', '[]')] };
  if (p.includes('/issues?')) {
    const n = /milestone=(\\d+)/.exec(p)[1];
    const pages = env('FAKE_ISSUE_PAGES', '{}')[n];
    return { rest: pages || [env('FAKE_ISSUES', '{}')[n] || []] };
  }
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
const issue = (number: number, extra: Record<string, unknown> = {}) => ({
  number,
  title: `issue ${number}`,
  labels: [],
  assignees: [],
  ...extra,
});

describe('Get-Milestones.ps1 -Mode close', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-close-'));
    fake = createFakeGh(tmp, handler);
  });
  afterAll(() => worker.close());

  const base = {
    FAKE_TAGS: ['v1.2.0'],
    FAKE_MILESTONES: [ms(5, '1.2.0'), ms(6, '1.3.0'), ms(4, '1.1.0', 'closed')],
  };
  // runs close and returns the result plus the write calls (PATCH and issue edit) it made
  const close = async (args: string[], env: Record<string, unknown> = {}) => {
    const before = fake.calls().length;
    const r = await worker.run(['-Mode', 'close', ...args], {
      cwd: tmp,
      env: {
        ...fake.env(),
        ...Object.fromEntries(
          Object.entries({ ...base, ...env }).map(([k, v]) => [k, JSON.stringify(v)]),
        ),
      },
    });
    const writes = fake
      .calls()
      .slice(before)
      .filter((c) => c.args.includes('-X') || c.args[0] === 'issue')
      .map((c) => c.args);
    return { r, writes };
  };
  const ok = async (args: string[], env: Record<string, unknown> = {}) => {
    const { r, writes } = await close(args, env);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    return { out: JSON.parse(r.stdout), writes };
  };
  const patch = ['api', '-X', 'PATCH', 'repos/{owner}/{repo}/milestones/5', '-f', 'state=closed'];

  it('tagged milestone without open issues is closed (leading v dropped)', async () => {
    const { out, writes } = await ok(['-Name', 'v1.2.0']);
    expect(out).toMatchObject({
      closed: true,
      milestone: { number: 5, title: '1.2.0', state: 'closed' },
      moved: [],
      openIssues: [],
    });
    expect(writes).toEqual([patch]);
  });

  it('already closed: nothing changes', async () => {
    const { out, writes } = await ok(['-Name', '1.1.0'], { FAKE_TAGS: [] });
    expect(out).toMatchObject({ closed: false, milestone: { number: 4, state: 'closed' } });
    expect(writes).toEqual([]);
  });

  it('open issues without -MoveTo: listed, nothing closed or moved, pull requests ignored', async () => {
    const { out, writes } = await ok(['-Name', '1.2.0'], {
      FAKE_ISSUES: { 5: [issue(11), issue(12, { pull_request: {} })] },
    });
    expect(out).toMatchObject({
      closed: false,
      milestone: { state: 'open' },
      moved: [],
      openIssues: [{ number: 11, title: 'issue 11' }],
    });
    expect(out.openIssues).toHaveLength(1);
    expect(writes).toEqual([]);
  });

  it('open issues with -MoveTo: moved to the existing milestone, then closed', async () => {
    const { out, writes } = await ok(['-Name', '1.2.0', '-MoveTo', 'v1.3.0'], {
      FAKE_ISSUES: { 5: [issue(11), issue(13), issue(12, { pull_request: {} })] },
    });
    expect(out).toMatchObject({
      closed: true,
      moved: [{ number: 11 }, { number: 13 }],
      openIssues: [],
    });
    expect(writes).toEqual([
      ['issue', 'edit', '11', '--milestone', '1.3.0'],
      ['issue', 'edit', '13', '--milestone', '1.3.0'],
      patch,
    ]);
  });

  it.each([
    {
      case: 'title is not x.y.z',
      args: ['-Name', 'next'],
      env: {},
      msg: "invalid milestone name 'next'",
    },
    {
      case: 'milestone missing',
      args: ['-Name', '9.9.9'],
      env: {},
      msg: "milestone '9.9.9' not found",
    },
    { case: 'tag missing', args: ['-Name', '1.3.0'], env: {}, msg: 'tag v1.3.0 does not exist' },
    {
      case: '-MoveTo does not exist',
      args: ['-Name', '1.2.0', '-MoveTo', '2.0.0'],
      env: { FAKE_ISSUES: { 5: [issue(11)] } },
      msg: "target milestone '2.0.0' not found",
    },
    {
      case: '-MoveTo is closed',
      args: ['-Name', '1.2.0', '-MoveTo', '1.1.0'],
      env: { FAKE_ISSUES: { 5: [issue(11)] } },
      msg: "target milestone '1.1.0' is closed",
    },
    {
      case: '-MoveTo is the milestone being closed',
      args: ['-Name', '1.2.0', '-MoveTo', '1.2.0'],
      env: { FAKE_ISSUES: { 5: [issue(11)] } },
      msg: 'target milestone is the milestone to close',
    },
    {
      case: '-MoveTo does not exist, no open issues',
      args: ['-Name', '1.2.0', '-MoveTo', '2.0.0'],
      env: {},
      msg: "target milestone '2.0.0' not found",
    },
    {
      case: '-MoveTo is closed, no open issues',
      args: ['-Name', '1.2.0', '-MoveTo', '1.1.0'],
      env: {},
      msg: "target milestone '1.1.0' is closed",
    },
    {
      case: '-MoveTo is invalid, no open issues',
      args: ['-Name', '1.2.0', '-MoveTo', 'later'],
      env: {},
      msg: "invalid -MoveTo 'later'",
    },
    {
      case: '-MoveTo is not x.y.z',
      args: ['-Name', '1.2.0', '-MoveTo', 'later'],
      env: { FAKE_ISSUES: { 5: [issue(11)] } },
      msg: "invalid -MoveTo 'later'",
    },
  ])('$case: exit 1, no write', async ({ args, env, msg }) => {
    const { r, writes } = await close(args, env);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(msg);
    expect(writes).toEqual([]);
  });

  it('failing issue edit: exit 1 with the moved-so-far list, milestone not closed', async () => {
    const { r, writes } = await close(['-Name', '1.2.0', '-MoveTo', '1.3.0'], {
      FAKE_ISSUES: { 5: [issue(11), issue(13)] },
      FAKE_FAIL: { edit: '13' },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('moving #13 to milestone 1.3.0 failed (moved so far: #11)');
    expect(writes.some((w) => w.includes('PATCH'))).toBe(false);
  });

  it('failing PATCH: exit 1 after the issues were moved', async () => {
    const { r, writes } = await close(['-Name', '1.2.0', '-MoveTo', '1.3.0'], {
      FAKE_ISSUES: { 5: [issue(11)] },
      FAKE_FAIL: { patch: true },
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('closing milestone 1.2.0 failed');
    expect(writes).toEqual([['issue', 'edit', '11', '--milestone', '1.3.0'], patch]);
  });

  it('open issues over several pages are all moved, pull requests skipped', async () => {
    const { out, writes } = await ok(['-Name', '1.2.0', '-MoveTo', '1.3.0'], {
      FAKE_ISSUE_PAGES: {
        5: [[issue(11), issue(12, { pull_request: {} })], [issue(13)], [issue(14)]],
      },
    });
    expect(out.moved.map((i: { number: number }) => i.number)).toEqual([11, 13, 14]);
    expect(writes).toHaveLength(4);
  });

  describe('numbered milestones (#234)', () => {
    const numbered = {
      FAKE_TAGS: ['v1.0.0', 'v1.1.0', 'v1.2.0'],
      FAKE_MILESTONES: [
        ms(7, 'M1 (1.0.0)', 'closed'),
        ms(8, 'M2'),
        ms(9, 'M3'),
        ms(10, '1.1.0', 'closed'),
      ],
    };
    const patchM = (n: number, title: string) => [
      'api',
      '-X',
      'PATCH',
      `repos/{owner}/{repo}/milestones/${n}`,
      '-f',
      'state=closed',
      '-f',
      `title=${title}`,
    ];

    it('without -Version: the newest release tag without a milestone, renamed and closed in one PATCH', async () => {
      const { out, writes } = await ok(['-Name', 'M2'], numbered);
      expect(out).toMatchObject({
        closed: true,
        version: '1.2.0',
        milestone: { number: 8, title: 'M002 (1.2.0)', state: 'closed' },
      });
      expect(writes).toEqual([patchM(8, 'M002 (1.2.0)')]);
    });

    it('with -Version: that tag is used even when a newer one exists', async () => {
      const { out, writes } = await ok(['-Name', 'M2', '-Version', 'v1.2.0'], {
        ...numbered,
        FAKE_TAGS: ['v1.2.0', 'v1.3.0'],
      });
      expect(out).toMatchObject({ closed: true, version: '1.2.0' });
      expect(writes).toEqual([patchM(8, 'M002 (1.2.0)')]);
    });

    it('open issues moved to M<m>, then renamed and closed', async () => {
      const { out, writes } = await ok(['-Name', 'M2', '-MoveTo', 'M3'], {
        ...numbered,
        FAKE_ISSUES: { 8: [issue(21)] },
      });
      expect(out).toMatchObject({ closed: true, moved: [{ number: 21 }] });
      expect(writes).toEqual([
        ['issue', 'edit', '21', '--milestone', 'M3'],
        patchM(8, 'M002 (1.2.0)'),
      ]);
    });

    it('open issues without -MoveTo: no rename, no close', async () => {
      const { out, writes } = await ok(['-Name', 'M2'], {
        ...numbered,
        FAKE_ISSUES: { 8: [issue(21)] },
      });
      expect(out).toMatchObject({
        closed: false,
        milestone: { title: 'M2' },
        openIssues: [{ number: 21 }],
      });
      expect(writes).toEqual([]);
    });

    it('already closed (found by M<n> although the title has the version): unchanged', async () => {
      const { out, writes } = await ok(['-Name', 'M1'], numbered);
      expect(out).toMatchObject({ closed: false, milestone: { number: 7, state: 'closed' } });
      expect(writes).toEqual([]);
    });

    it.each([
      {
        case: 'no unassigned release tag',
        args: ['-Name', 'M2'],
        env: { FAKE_TAGS: ['v1.0.0', 'v1.1.0'] },
        msg: 'no release tag without a milestone',
      },
      {
        case: '-Version tag missing',
        args: ['-Name', 'M2', '-Version', '9.0.0'],
        env: {},
        msg: 'tag v9.0.0 does not exist',
      },
      {
        case: '-Version already assigned',
        args: ['-Name', 'M2', '-Version', '1.0.0'],
        env: {},
        msg: 'already assigned to another milestone',
      },
      {
        case: '-Version not x.y.z',
        args: ['-Name', 'M2', '-Version', 'soon'],
        env: {},
        msg: "invalid -Version 'soon'",
      },
      {
        case: 'milestone missing',
        args: ['-Name', 'M9'],
        env: {},
        msg: "milestone 'M9' not found",
      },
    ])('$case: exit 1, no write', async ({ args, env, msg }) => {
      const { r, writes } = await close(args, { ...numbered, ...env });
      expect(r.status).toBe(1);
      expect(r.stderr).toContain(msg);
      expect(writes).toEqual([]);
    });
  });
});
