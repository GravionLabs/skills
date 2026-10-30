import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const skill = fs.readFileSync(path.join(root, 'skills/github/github-release/SKILL.md'), 'utf-8');
const finish = skill.slice(skill.indexOf('## finish'), skill.indexOf('## Gotchas'));
const bump = finish.split('\n').find((l) => l.startsWith('2. Bump')) ?? '';

// #881: GitVersion on the default branch ignores the branch config of release/next, so a release from it was tagged as a patch.
describe('github-release finish bump (#881)', () => {
  it('adds the +semver commit on every release branch, minor and major', () => {
    expect(bump).toContain('"chore: release minor|major" -m "+semver: minor|major"');
    expect(bump).toContain('`hasSemverCommit`');
    expect(bump).toContain('`hasMajorCommit`');
  });

  it('no longer claims that minor needs no commit on release/next', () => {
    expect(skill).not.toContain('minor adds nothing');
    expect(skill).not.toContain('version comes from the GitVersion branch config');
  });
});
