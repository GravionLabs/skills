import * as fs from 'fs';
import * as path from 'path';

const skillDir = path.resolve(__dirname, '../../../skills/github/github-release');
const read = (p: string) => fs.readFileSync(p, 'utf8');

const skill = read(path.join(skillDir, 'SKILL.md'));
const help = read(path.join(skillDir, 'references/help.md'));
const guide = read(path.resolve(__dirname, '../../../site/guides/release.md'));

const docs: [string, string][] = [
  ['SKILL.md', skill],
  ['references/help.md', help],
  ['site/guides/release.md', guide],
];

describe('github-release milestone hint after the release tag', () => {
  it.each(docs)('%s points to close M<n> and create of the next M', (_name, text) => {
    expect(text).toMatch(/\/github-milestone close M(<nnn>|\d{3})`?\s/);
    expect(text).toMatch(/\/github-milestone create/);
    expect(text).toMatch(
      /create.{0,60}first.{0,80}then .{0,20}close M(<nnn>|\d{3}) --move-to M(<n\+1>|<nnn\+1>|\d{3})/,
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

describe('release routine creates the next milestone before close --move-to', () => {
  const ms = read(path.resolve(__dirname, '../../../skills/github/github-milestone/SKILL.md'));
  const texts: [string, string][] = [
    ['site/guides/release.md', guide],
    ['github-release SKILL.md', skill],
    ['github-milestone SKILL.md', ms],
  ];

  const segments = (text: string) => text.split('\n').flatMap((line) => line.split(/(?<=[.;])\s+/));

  it.each(texts)('%s says why: --move-to needs an existing open target', (_name, text) => {
    expect(text).not.toMatch(/tag, `close`, then `create`/);
    expect(text).toMatch(/--move-to.{0,80}(exist|open)|(exist|open).{0,80}--move-to/);
  });

  it.each(texts)('%s puts create before close in every --move-to statement', (_name, text) => {
    const both = segments(text).filter(
      (s) => s.includes('--move-to') && /\bcreate\b/.test(s) && /\bclose\b/.test(s),
    );
    expect(both.length).toBeGreaterThan(0);
    for (const s of both) {
      expect(s.search(/\bcreate\b/), s).toBeLessThan(s.search(/\bclose\b/));
    }
  });

  it.each(texts)('%s has no close line before the create line in a hint block', (_name, text) => {
    const lines = text.split('\n');
    const close = lines.findIndex((l) => /^\/github-milestone close M\d+$/.test(l));
    const create = lines.findIndex((l) => /^\/github-milestone create M\d+$/.test(l));
    if (close >= 0 && create >= 0) expect(create).toBeLessThan(close);
  });

  it.each([
    ['site/guides/release.md', guide],
    ['github-release SKILL.md', skill],
  ])('%s legacy hint creates before close', (_name, text) => {
    expect(text).toMatch(
      /`create` the next `x\.y\.z` milestone first, then `\/github-milestone close/,
    );
  });
});

describe('migrating legacy milestones (#243)', () => {
  const deliverGuide = read(path.resolve(__dirname, '../../../site/guides/deliver.md'));
  const section = guide.slice(guide.indexOf('## Migrate legacy milestones'));

  it('release guide has the tamias table and the commands', () => {
    expect(section).toContain('M002 (0.1.1)');
    expect(section).toContain('/github-milestone rename 0.2.0 "M002 (0.1.1)"');
    expect(section).toContain('close M002 --version 0.1.1 --move-to M003');
    expect(section).toContain('release-review-<title>.json');
    expect(section).toContain('docs/roadmap.md');
  });

  it('deliver guide links to the section', () => {
    expect(deliverGuide).toContain('release.md#migrate-legacy-milestones');
  });
});
