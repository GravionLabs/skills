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
    // the harness starts agent worktrees at the default branch: a commit of origin/main not on release/next
    git(repo, 'switch', '-q', '--orphan', 'main');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'main only');
    git(repo, 'push', '-q', 'origin', 'main');
    git(repo, 'branch', 'worktree-h'); // worktree gone, commit on origin/main: deleted
    git(repo, 'switch', '-q', 'release/next');
    git(repo, 'branch', '-q', '-D', 'main');
    git(repo, 'fetch', '-q', 'origin');
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
      {
        branch: 'worktree-f',
        reason: 'commits not on any remote branch',
        command: 'git branch -D worktree-f',
      },
    ]);
    expect(r.json.branchesDeleted.sort()).toEqual(
      [
        'feat/12-x',
        'wip-12',
        'worktree-a',
        'worktree-b',
        'worktree-c',
        'worktree-g',
        'worktree-h',
      ].sort(),
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

// #45: a delete refused by a sandbox or hook must not vanish from the report
describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Remove-PbiWorktrees.ps1 failed branch delete',
  () => {
    let root: string;
    let repo: string;
    let shim: string;
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();

    beforeAll(() => {
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pbiwt-fail-')));
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
      git(repo, 'switch', '-q', '-c', 'feat/12-x');
      git(repo, 'commit', '-q', '--allow-empty', '-m', 'feat');
      git(repo, 'switch', '-q', 'release/next');
      // a git shim first on PATH: branch -D is refused, everything else goes to the real git
      const realGit = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
      shim = path.join(root, 'shim');
      fs.mkdirSync(shim, { recursive: true });
      fs.writeFileSync(
        path.join(shim, 'git'),
        `#!/bin/sh
for a in "$@"; do
  if [ "$a" = branch ]; then
    case " $* " in
      *" -D "*) echo 'error: refusing to delete branch' >&2; exit 1;;
    esac
  fi
done
exec ${JSON.stringify(realGit)} "$@"
`,
        { mode: 0o755 },
      );
    });
    afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

    it('lists a refused branch delete in left with the stderr line', () => {
      const gh = createFakeGh(
        path.join(root, 'gh'),
        `(call) => ({ rest: { headRefName: 'feat/12-x', baseRefName: 'release/next', commits: [] } })`,
      );
      const env = gh.env();
      env.PATH = `${shim}${path.delimiter}${env.PATH}`;
      const r = spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, '-Pr', '9', '-Issue', '12'], {
        cwd: repo,
        encoding: 'utf8',
        env,
      });
      expect(r.status, r.stderr).toBe(0);
      const json = JSON.parse(r.stdout);
      expect(json.left).toEqual([
        {
          branch: 'feat/12-x',
          reason: 'git branch -D failed: error: refusing to delete branch',
          command: 'git branch -D feat/12-x',
        },
      ]);
      expect(json.branchesDeleted).toEqual([]);
      expect(git(repo, 'for-each-ref', '--format=%(refname:short)', 'refs/heads')).toContain(
        'feat/12-x',
      );
    });
  },
);
