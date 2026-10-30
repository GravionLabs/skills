import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Remove-PbiWorktrees.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// #858: worktrees and branches a merged PBI leaves behind, as found after the agentlens trial
describe.skipIf(!hasPwsh || process.platform === 'win32')('Remove-PbiWorktrees.ps1', () => {
  let root: string;
  let repo: string;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const wt = (name: string) => path.join(repo, '.claude/worktrees', name);
  const run = (gh: ReturnType<typeof createFakeGh>, cwd = repo) => {
    const r = spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, '-Pr', '9', '-Issue', '12'], {
      cwd,
      encoding: 'utf8',
      env: gh.env(),
    });
    return { ...r, json: r.stdout.trim() ? JSON.parse(r.stdout) : null };
  };
  const branchesOf = () => git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads');

  let pr: string[];
  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pbiwt-')));
    const origin = path.join(root, 'origin.git');
    repo = path.join(root, 'repo');
    git(root, 'init', '-q', '--bare', '-b', 'release/next', origin);
    git(root, 'clone', '-q', origin, repo);
    for (const [k, v] of [
      ['user.email', 't@example.com'],
      ['user.name', 't'],
      ['commit.gpgsign', 'false'],
    ])
      git(repo, 'config', k, v);
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
    git(repo, 'push', '-q', 'origin', 'release/next');
    // the PBI branch with two commits, as the implement and fix subagents push it
    git(repo, 'switch', '-q', '-c', 'feat/12-x');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'feat');
    const c1 = git(repo, 'rev-parse', 'HEAD');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'fix');
    const c2 = git(repo, 'rev-parse', 'HEAD');
    pr = [c1, c2];
    git(repo, 'switch', '-q', 'release/next');
    // harness worktrees: worktree-<name> branches at the base, then moved like the trial's agents
    for (const n of ['a', 'b', 'c', 'd', 'e', 'f'])
      git(repo, 'worktree', 'add', '-q', '-b', `worktree-${n}`, wt(n));
    git(wt('a'), 'switch', '-q', 'feat/12-x'); // implement: on the head branch
    git(wt('b'), 'checkout', '-q', '--detach', c1); // gate/review: detached at a PR commit
    git(wt('c'), 'switch', '-q', '-c', 'wip-12', c2); // fix: on wip-<nr>
    git(wt('d'), 'checkout', '-q', '--detach', c2);
    fs.writeFileSync(path.join(wt('d'), 'dirty.txt'), 'x'); // uncommitted: kept and reported
    git(wt('e'), 'switch', '-q', '-c', 'feat/99-other'); // another PBI: untouched
    git(wt('f'), 'commit', '-q', '--allow-empty', '-m', 'own work'); // worktree-f has own commits
    git(repo, 'worktree', 'remove', wt('f'));
    git(repo, 'branch', 'worktree-g'); // orphan at the base: deleted
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it('removes the clean worktrees and branches of the PBI and reports the rest', () => {
    const gh = createFakeGh(
      path.join(root, 'gh'),
      `(call) => ({ rest: { headRefName: 'feat/12-x', baseRefName: 'release/next', commits: ${JSON.stringify(pr.map((oid) => ({ oid })))} } })`,
    );
    const r = run(gh);
    expect(r.status, r.stderr).toBe(0);
    expect(gh.calls()[0].args).toEqual([
      'pr',
      'view',
      '9',
      '--json',
      'headRefName,baseRefName,commits',
    ]);
    expect(r.json.removed).toEqual([wt('a'), wt('b'), wt('c')]);
    expect(r.json.left).toEqual([
      {
        path: wt('d'),
        reason: 'uncommitted changes',
        command: `git worktree remove --force ${wt('d')}`,
      },
    ]);
    expect(r.json.branchesDeleted.sort()).toEqual(
      ['feat/12-x', 'wip-12', 'worktree-a', 'worktree-b', 'worktree-c', 'worktree-g'].sort(),
    );
    const left = branchesOf();
    for (const b of ['feat/99-other', 'worktree-d', 'worktree-e', 'worktree-f'])
      expect(left).toContain(b);
    expect(git(repo, 'worktree', 'list')).toContain(wt('e'));
  });

  it('exits 1 when the PR cannot be read', () => {
    const gh = createFakeGh(path.join(root, 'gh-fail'), `() => { throw new Error('no PR') }`);
    const r = run(gh);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('gh pr view 9 failed');
  });
});
