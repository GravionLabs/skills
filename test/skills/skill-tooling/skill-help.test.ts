import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { HELP_POINTER, skillHelpProblems } from '../../helpers/skill-help';

const good = (flags = '--max <n>') => ({
  skill: `---\nname: demo\n---\n\nUsage: \`/demo ${flags}\`\n\n${HELP_POINTER}\n`,
  help: [
    '# /demo',
    '## Usage',
    '## Arguments and flags',
    '`--max`',
    '## Examples',
    '## Config',
    'none',
    '## See also',
  ].join('\n'),
});

describe('skill-help helper', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-help-'));
    fs.mkdirSync(path.join(dir, 'demo/references'), { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const make = (skill: string, help?: string) => {
    fs.writeFileSync(path.join(dir, 'demo/SKILL.md'), skill);
    if (help !== undefined) fs.writeFileSync(path.join(dir, 'demo/references/help.md'), help);
    return skillHelpProblems(path.join(dir, 'demo'));
  };

  it('accepts a conforming skill', () => {
    const g = good();
    expect(make(g.skill, g.help)).toEqual([]);
  });

  it('reports a missing help.md', () => {
    expect(make(good().skill)).toEqual(['demo: references/help.md missing']);
  });

  it('reports missing sections, too many lines and a missing pointer', () => {
    const p = make('---\nname: demo\n---\n', `# /demo\n## Usage\n${'x\n'.repeat(70)}`);
    expect(p).toContain('help.md has 72 lines');
    expect(p).toContain('help.md lacks section "## Examples"');
    expect(p).toContain('SKILL.md lacks exactly one help pointer line');
  });

  it('reports a flag of the usage line missing from help.md', () => {
    const g = good('--max <n> --unattended');
    expect(make(g.skill, g.help)).toEqual(['help.md lacks --unattended']);
  });
});
