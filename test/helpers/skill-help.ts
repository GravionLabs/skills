import * as fs from 'fs';
import * as path from 'path';

export const HELP_SECTIONS = [
  'Usage',
  'Arguments and flags',
  'Examples',
  'Config',
  'See also',
] as const;
export const HELP_POINTER =
  '`help` (or `--help`, `-h`): print `references/help.md` unchanged, nothing else.';
export const HELP_MAX_LINES = 60;

/** Problems of the help convention for one skill directory; empty when it conforms. */
export function skillHelpProblems(skillDir: string): string[] {
  const problems: string[] = [];
  const helpPath = path.join(skillDir, 'references/help.md');
  const name = path.basename(skillDir);
  if (!fs.existsSync(helpPath)) return [`${name}: references/help.md missing`];
  const help = fs.readFileSync(helpPath, 'utf8');
  const lines = help.replace(/\n$/, '').split('\n');
  if (lines.length > HELP_MAX_LINES) problems.push(`help.md has ${lines.length} lines`);
  if (lines[0] !== `# /${name}`) problems.push(`help.md title is not "# /${name}"`);
  for (const s of HELP_SECTIONS) {
    if (!lines.some((l) => l.trim() === `## ${s}`)) {
      problems.push(`help.md lacks section "## ${s}"`);
    }
  }
  const skillLines = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8').split('\n');
  if (skillLines.filter((l) => l.trim() === HELP_POINTER).length !== 1) {
    problems.push('SKILL.md lacks exactly one help pointer line');
  }
  const usage = skillLines.find((l) => l.includes(`/${name}`) && /--[a-z]/i.test(l));
  for (const flag of new Set(usage?.match(/--[a-z][\w-]*/gi) ?? [])) {
    if (flag !== '--help' && !help.includes(flag)) problems.push(`help.md lacks ${flag}`);
  }
  return problems;
}

/** Asserts the help convention for a skill directory (use in the test of a skill). */
export function expectSkillHelp(skillDir: string): void {
  expect(skillHelpProblems(skillDir)).toEqual([]);
}
