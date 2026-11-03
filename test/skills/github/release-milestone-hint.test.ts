import * as fs from 'fs';
import * as path from 'path';

const skillDir = path.resolve(__dirname, '../../../skills/github/github-release');
const read = (p: string) => fs.readFileSync(p, 'utf8');

const skill = read(path.join(skillDir, 'SKILL.md'));
const help = read(path.join(skillDir, 'references/help.md'));
const guide = read(path.resolve(__dirname, '../../../docs/guides/release.md'));

const docs: [string, string][] = [
  ['SKILL.md', skill],
  ['references/help.md', help],
  ['docs/guides/release.md', guide],
];

describe('github-release milestone hint after the release tag', () => {
  it.each(docs)('%s points to close M<n> and create of the next M', (_name, text) => {
    expect(text).toMatch(/\/github-milestone close M(<n>|\d+)`?\s/);
    expect(text).toMatch(/\/github-milestone create/);
    expect(text).toMatch(
      /create.{0,60}first.{0,80}then .{0,20}close M(<n>|\d+) --move-to M(<n\+1>|\d+)/,
    );
  });

  it.each(docs)('%s keeps the legacy x.y.z instruction', (_name, text) => {
    expect(text).toMatch(/[Ll]egacy/);
    expect(text).toMatch(/\/github-milestone close (<x\.y\.z>|\d+\.\d+\.\d+) \[--move-to <next>\]/);
    expect(text).toMatch(/create.{0,10} the next `x\.y\.z`/);
  });

  it('SKILL.md takes the version from the tag and picks the branch from a read-only milestone list', () => {
    expect(skill).toContain('pwsh ../github-milestone/scripts/Get-Milestones.ps1 -Mode list');
    expect(skill).toMatch(/version comes from the tag/);
    expect(skill).toMatch(/open `x\.y\.z` milestone with `tagged: true`/);
    expect(skill).toMatch(/Neither, or `github-milestone` not installed: no hint/);
  });

  it('the referenced milestone script exists', () => {
    expect(
      fs.existsSync(path.resolve(skillDir, '../github-milestone/scripts/Get-Milestones.ps1')),
    ).toBe(true);
  });
});
