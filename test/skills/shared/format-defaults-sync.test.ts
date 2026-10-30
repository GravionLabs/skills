import * as fs from 'fs';
import * as path from 'path';

// The `## Format` section of every <lang>-implementation skill spells the default commands of Format-Changed.ps1;
// this test keeps both in sync. It reads the `$defaults` table of the script as text (no pwsh): that the script really
// runs these commands per language (and in a Biome project) is pinned by the defaults table of format-changed.test.ts.
const PACKAGES = path.resolve(__dirname, '../../../skills');
const SCRIPT = path.join(PACKAGES, 'implementation/scripts/Format-Changed.ps1');
const LANGS = ['ts', 'ng', 'py', 'dotnet', 'rust', 'go'];

const sectionLines = (lang: string): string[] => {
  const skill = fs.readFileSync(path.join(PACKAGES, `${lang}-implementation/SKILL.md`), 'utf8');
  const section = /^## Format$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(skill)?.[1] ?? '';
  return section.split('\n').filter((l) => l.trim());
};
const line = (lang: string, label: string): string =>
  sectionLines(lang).find((l) => l.startsWith('- ' + label)) ?? '';
// the backticked commands of a line, in order (only those with {files}: `biome.json[c]` is a file name)
const commands = (text: string): string[] =>
  [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((c) => c.includes('{files}'));

type Mode = 'Format' | 'Check';
// the quoted strings of `<Mode> = @('a', 'b')` in one step line of the script
const stepCommands = (step: string, mode: Mode): string[] => {
  const list = new RegExp(`\\b${mode} = @\\(([^)]*)\\)`).exec(step)?.[1] ?? '';
  return [...list.matchAll(/'([^']*)'/g)].map((m) => m[1]);
};

const script = fs.readFileSync(SCRIPT, 'utf8');
// `$defaults = @{ <lang> = @( @{ Tool = ...; Format = @(...); Check = @(...) }, ... ) ... }`: the step lines per language key
const plainSteps: Record<string, string[]> = {};
{
  const table = /^\$defaults = @\{$([\s\S]*?)^\}$/m.exec(script)?.[1] ?? '';
  let lang = '';
  for (const l of table.split('\n')) {
    const key = /^\s*(\w+)\s*=\s*@\(/.exec(l);
    if (key) lang = key[1];
    else if (lang && /@\{ Tool = /.test(l)) plainSteps[lang] = [...(plainSteps[lang] ?? []), l];
  }
}
// ng reuses both ts steps (only the prettier extensions differ), so its commands are the ts commands
const ngFromTs = script.includes('$defaults.ng = @($defaults.ts[0].Clone(), $defaults.ts[1])');
if (ngFromTs) plainSteps.ng = plainSteps.ts;
// a Biome project replaces the steps of the languages in the foreach with the single biome step
const biomeLangs = (/foreach \(\$lang in ([^)]*)\)/.exec(script)?.[1] ?? '')
  .split(',')
  .map((s) => s.trim().replace(/'/g, ''));
const biomeStep = script.split('\n').find((l) => l.includes("@{ Tool = 'biome'")) ?? '';
const defaults = (lang: string, biome: boolean, mode: Mode): string[] =>
  (biome && biomeLangs.includes(lang) ? [biomeStep] : (plainSteps[lang] ?? [])).flatMap((s) =>
    stepCommands(s, mode),
  );

describe('## Format sections match the Format-Changed.ps1 defaults', () => {
  it('reads a defaults table from the script', () => {
    expect(Object.keys(plainSteps).sort()).toEqual([...LANGS].sort());
    expect(ngFromTs).toBe(true);
    expect(biomeLangs).toEqual(['ts', 'ng']);
    expect(stepCommands(biomeStep, 'Format')).toHaveLength(1);
  });

  it.each(LANGS)('%s: Format and Check (read-only) lines equal the script defaults', (lang) => {
    const format = commands(line(lang, 'Format:'));
    const check = commands(line(lang, 'Check (read-only):'));
    expect(format.length).toBeGreaterThan(0);
    expect(check.length).toBeGreaterThan(0);
    expect(format).toEqual(defaults(lang, false, 'Format'));
    expect(check).toEqual(defaults(lang, false, 'Check'));
  });

  it.each(LANGS)('%s: a Biome project line exactly when the biome default applies', (lang) => {
    if (!biomeLangs.includes(lang)) {
      expect(line(lang, 'Biome project')).toBe('');
      return;
    }
    const [format, check, ...rest] = commands(line(lang, 'Biome project'));
    expect(rest).toEqual([]);
    expect([format]).toEqual(defaults(lang, true, 'Format'));
    expect([check]).toEqual(defaults(lang, true, 'Check'));
  });
});
