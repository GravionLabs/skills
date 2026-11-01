import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf-8');
const skill = read('skills/github/github-release/SKILL.md');
const finish = skill.slice(skill.indexOf('## finish'), skill.indexOf('## Gotchas'));
const bump = finish.split('\n').find((l) => l.startsWith('2. Bump')) ?? '';
const branches = read('skills/github/github-issue/references/release-branches.md');
const contributing = read('CONTRIBUTING.md');
const releases = contributing.slice(contributing.indexOf('## Releases'));
const pullRequest = read('skills/github/github-pull-request/SKILL.md');

// #101: the bump comes from the Conventional Commits (GravionLabs/ci#107); finish adds no +semver: minor commit.
describe('github-release finish bump (#101)', () => {
  it('adds no bump commit by default, on release/next and on release/<x.y>', () => {
    expect(bump).toContain('no commit by default, on `release/next` and on `release/<x.y>`');
    expect(bump).toContain('`fix:` → patch, `feat:` → minor');
    expect(bump).toContain('only fixes is a patch release');
    expect(skill).not.toContain('+semver: minor');
    expect(skill).not.toContain('chore: release minor');
    expect(skill).not.toContain('`finish` adds it');
  });

  it('keeps finish major as the escape hatch, once', () => {
    expect(bump).toContain('-m "chore: release major" -m "+semver: major"');
    expect(bump).toContain('only when `hasMajorCommit` is false');
    expect(skill).not.toContain('hasSemverCommit');
  });

  it('keeps the release PR a merge commit and names why', () => {
    expect(finish).toMatch(/--merge` \(merge commit, never squash: .*`feat:`\/`fix:` commits/);
    expect(branches).toContain('the release PR stays a merge commit (never squash)');
    expect(releases).toContain('merged with a merge commit, never squashed');
  });

  it('release-branches.md: bump rule, version source and parallel lines follow the commits', () => {
    expect(bullet(branches, 'Bump rule')).toContain('from the Conventional Commits');
    expect(bullet(branches, 'Bump rule')).toContain('`finish major`');
    expect(bullet(branches, 'Version source')).toContain('*-version-bump-message');
    expect(bullet(branches, 'Version source')).not.toContain('increment: Minor');
    expect(bullet(branches, 'Parallel lines')).toContain('adds no commit on a `release/<x.y>`');
    expect(branches).not.toContain('+semver: minor');
  });

  it('CONTRIBUTING.md Releases states the commit-derived bump', () => {
    expect(releases).toContain('`fix:` → patch, `feat:` → minor');
    expect(releases).not.toContain('increments the minor version by default');
  });

  it('hotfix PRs into main are merge commits, work PRs into release/** stay squash', () => {
    expect(bullet(branches, 'Hotfix path')).toContain('merge commit');
    expect(bullet(branches, 'Hotfix path')).not.toContain('squash into `main`');
    const hotfixRow =
      branches.split('\n').find((l) => l.startsWith('| `fix/<nr>-<slug>` hotfix')) ?? '';
    expect(hotfixRow).toContain('merge commit');
    expect(hotfixRow).not.toContain('squash');
    const workRow = branches.split('\n').find((l) => l.startsWith('| `<type>/<nr>-<slug>`')) ?? '';
    expect(workRow).toContain('squash (the `release/**` ruleset allows only squash');
    expect(pullRequest).toContain('`gh pr merge <pr> --auto --squash`');
    expect(pullRequest).not.toContain('`--squash` (hotfix)');
    expect(pullRequest).toContain('(release or hotfix) is merged by the owner with `--merge`');
  });
});

function bullet(text: string, name: string) {
  const start = text.indexOf(`- **${name}:**`);
  return text.slice(start, text.indexOf('\n- **', start + 1));
}
