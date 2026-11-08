import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #481: step 1 picks up PRs that wait for auto-merge (Get-MergingPrs.ps1)
const SKILL = path.resolve(__dirname, '../../../skills/delivery/deliver');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe('deliver merging docs (#481)', () => {
  const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  const ref = fs.readFileSync(path.join(SKILL, 'references/merging.md'), 'utf8');
  it('step 1 and 9 name the merging PRs and the waiting lines', () => {
    expect(skill).toContain('Get-MergingPrs.ps1');
    expect(skill).toContain('#<nr> select: merging, waits for checks');
    expect(skill).toContain('#<nr> select: waits for merge of #<blocker>');
    expect(skill).toMatch(/No PR of the milestone waits for its merge/);
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
    expect(ref).toContain('pulls?base=release/next&state=open');
  });
});

describe.skipIf(!hasPwsh || process.platform === 'win32')('Get-MergingPrs.ps1 (#481)', () => {
  let dir: string;
  let worker: PwshWorker;
  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'merging-')));
    worker = new PwshWorker(path.join(SKILL, 'scripts/Get-MergingPrs.ps1'));
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  // checks: head sha -> check runs; base: the checks of release/next
  const run = async (
    name: string,
    prs: object[],
    checks: Record<string, object[]>,
    detail: object = {},
    issues = '10,11',
  ) => {
    const d = path.join(dir, name);
    const gh = createFakeGh(
      d,
      `(call) => {
        const a = call.args[1];
        if (/pulls\\?base=release\\/next&state=open/.test(a)) return { rest: ${JSON.stringify(prs)} };
        if (/branches\\/release\\/next$/.test(a)) return { rest: { commit: { sha: 'base' } } };
        const m = /commits\\/(\\w+)\\/check-runs/.exec(a);
        if (m) return { rest: { check_runs: ${JSON.stringify(checks)}[m[1]] || [] } };
        if (/pulls\\/\\d+$/.test(a)) return { rest: ${JSON.stringify(detail)} };
        throw new Error('unexpected gh ' + call.args.join(' '));
      }`,
    );
    const r = await worker.run(['-Issues', issues], { cwd: dir, env: gh.env() });
    expect(r.status).toBe(0);
    return {
      out: JSON.parse(r.stdout) as { issue: number; state: string; reason: string }[],
      calls: gh.calls().length,
    };
  };
  const pr = (n: number, branch: string, sha: string, auto = true) => ({
    number: n,
    html_url: `https://github.com/acme/app/pull/${n}`,
    head: { ref: branch, sha },
    auto_merge: auto ? { merge_method: 'squash' } : null,
  });
  const ok = { status: 'completed', conclusion: 'success', name: 'build' };

  it('a merged PR is not listed (PR gone, issue closed): empty result', async () => {
    const r = await run('merged', [], {});
    expect(r.out).toEqual([]);
    expect(r.calls).toBe(1);
  });

  it('green or running checks: waiting', async () => {
    const r = await run(
      'waiting',
      [pr(1, 'feat/10-a', 's1'), pr(2, 'feat/11-b', 's2')],
      {
        s1: [ok],
        s2: [{ status: 'in_progress', conclusion: null, name: 'build' }],
      },
      { mergeable: true, mergeable_state: 'clean' },
    );
    expect(r.out.map((x) => [x.issue, x.state])).toEqual([
      [10, 'waiting'],
      [11, 'waiting'],
    ]);
  });

  it('red by this change (green on release/next): red-change', async () => {
    const r = await run('red-change', [pr(1, 'feat/10-a', 's1')], {
      s1: [{ status: 'completed', conclusion: 'failure', name: 'test' }],
      base: [ok],
    });
    expect(r.out).toMatchObject([{ issue: 10, state: 'red-change', reason: 'red: test' }]);
  });

  it('red on release/next too, and a merge conflict: red-other', async () => {
    const bad = { status: 'completed', conclusion: 'failure', name: 'test' };
    const same = await run('red-other', [pr(1, 'feat/10-a', 's1')], { s1: [bad], base: [bad] });
    expect(same.out).toMatchObject([{ issue: 10, state: 'red-other' }]);
    const dirty = await run(
      'conflict',
      [pr(1, 'feat/10-a', 's1')],
      { s1: [ok] },
      { mergeable: false, mergeable_state: 'dirty' },
    );
    expect(dirty.out).toMatchObject([{ issue: 10, state: 'red-other', reason: 'merge conflict' }]);
  });

  it('ignores PRs without auto-merge and issues outside the set', async () => {
    const r = await run('ignored', [pr(1, 'feat/10-a', 's1', false), pr(2, 'feat/99-z', 's2')], {});
    expect(r.out).toEqual([]);
  });
});
