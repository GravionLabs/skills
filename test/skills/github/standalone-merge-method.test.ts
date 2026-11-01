import * as fs from 'node:fs';
import * as path from 'node:path';

const standalone = fs.readFileSync(
  path.resolve(__dirname, '../../../skills/github/github-issue/references/standalone-issue.md'),
  'utf-8',
);
const mergeLine =
  standalone.split('\n').find((l) => l.startsWith('- If asked to also merge')) ?? '';

// #130: the main ruleset allows only merge commits (#101, #102); release/** PRs are squashed.
describe('github-issue standalone merge method per base (#130)', () => {
  it('squashes a PR into release/**', () => {
    expect(mergeLine).toContain('`gh pr merge <nr> --squash` into `release/**`');
  });

  it('merges a PR into main with a merge commit, never squashed, after the checks', () => {
    expect(mergeLine).toContain('`gh pr merge <nr> --merge` into `main`');
    expect(mergeLine).toContain('never squashed');
    expect(mergeLine).toContain('`gh pr checks <nr> --watch --interval 60` first');
  });

  it('has no squash merge into <base> or main', () => {
    expect(mergeLine).not.toContain('--squash` into `<base>`');
    expect(standalone).not.toMatch(/--squash`[^;\n]*into `main`/);
  });
});
