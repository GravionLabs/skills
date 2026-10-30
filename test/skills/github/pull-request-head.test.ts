import * as fs from 'fs';
import * as path from 'path';

const prSkill = fs.readFileSync(
  path.resolve(__dirname, '../../../skills/github/github-pull-request/SKILL.md'),
  'utf-8',
);

// #861: deliver opens the PR for a branch that is pushed from another worktree
describe('github-pull-request with a branch outside the current checkout', () => {
  it('reads commits and diff from origin/<branch> when branch is not the current one', () => {
    expect(prSkill).toMatch(
      /Passed and not the current branch[^\n]*`<head>` below is `origin\/<branch>`/,
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
