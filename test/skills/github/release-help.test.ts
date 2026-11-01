import * as fs from 'fs';
import * as path from 'path';
import { expectSkillHelp } from '../../helpers/skill-help';

const skillDir = path.resolve(__dirname, '../../../skills/github/github-release');

describe('github-release help', () => {
  it('follows the help convention', () => {
    expectSkillHelp(skillDir);
  });

  it('covers modes, state checks, the human gate and the changelog', () => {
    const help = fs.readFileSync(path.join(skillDir, 'references/help.md'), 'utf8');
    for (const term of ['cut', 'finish', 'Get-ReleaseState.ps1', '+semver: minor', 'git-cliff']) {
      expect(help).toContain(term);
    }
    expect(help).toMatch(/never merged by the skill/);
  });

  it('keeps SKILL.md within 100 lines', () => {
    const lines = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8').split('\n');
    expect(lines.length).toBeLessThanOrEqual(101);
  });
});
