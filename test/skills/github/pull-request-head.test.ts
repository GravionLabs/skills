import * as fs from 'fs';
import { execFileSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';

const prSkill = fs.readFileSync(
  path.resolve(__dirname, '../../../skills/github/github-pull-request/SKILL.md'),
  'utf-8',
);

// #861: deliver opens the PR for a branch that is pushed from another worktree
describe('github-pull-request with a branch outside the current checkout', () => {
  it('reads commits and diff from origin/<branch> when branch is not the current one', () => {
    expect(prSkill).toMatch(
      /Passed: `<head>` below is `origin\/<branch>`[^\n]*local HEAD, the working tree and uncommitted changes are ignored/,
    );
    expect(prSkill).toContain('`git log origin/<base>..<head> --oneline`');
    expect(prSkill).toContain('`git diff --stat origin/<base>...<head>`');
  });

  it('names the head branch explicitly on gh pr create', () => {
    expect(prSkill).toContain('--base <base> --head <branch>`');
  });

  it('pushes only from the current checkout', () => {
    expect(prSkill).toMatch(
      /if `<head>` is `HEAD` and `git log origin\/<branch>\.\.HEAD` is non-empty/,
    );
  });
});

// #224: with branch given the head is origin/<branch>, whatever the local checkout looks like
describe('github-pull-request head with a detached HEAD and a dirty tree', () => {
  let repo: string;
  const git = (...a: string[]) => execFileSync('git', a, { cwd: repo, encoding: 'utf8' }).trim();
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-head-'));
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a');
    git('add', '.');
    git('commit', '-qm', 'base');
    git('update-ref', 'refs/remotes/origin/release/next', 'HEAD');
    git('checkout', '-qb', 'feat/1-x');
    fs.writeFileSync(path.join(repo, 'feature.txt'), 'f');
    git('add', '.');
    git('commit', '-qm', 'feat: pushed work');
    git('update-ref', 'refs/remotes/origin/feat/1-x', 'HEAD');
    git('checkout', '-q', '--detach', 'origin/release/next');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'dirty');
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it('the documented commands on origin/<branch> see the pushed work, HEAD sees none', () => {
    expect(git('log', 'origin/release/next..origin/feat/1-x', '--oneline')).toContain(
      'pushed work',
    );
    expect(git('diff', '--stat', 'origin/release/next...origin/feat/1-x')).toContain('feature.txt');
    expect(git('log', 'origin/release/next..HEAD', '--oneline')).toBe('');
    expect(git('status', '--porcelain')).toContain('a.txt');
  });

  it('the skill tells to ignore HEAD and the dirty tree instead of refusing', () => {
    expect(prSkill).toMatch(/detached HEAD or dirty tree is no reason to refuse/);
    expect(prSkill).toContain('never from the local working tree');
  });
});
