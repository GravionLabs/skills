import * as fs from 'fs';
import * as path from 'path';
import { expectSkillHelp } from '../../helpers/skill-help';

const dir = path.resolve(__dirname, '../../../skills/delivery/roadmap');
const help = fs.readFileSync(path.join(dir, 'references/help.md'), 'utf-8');

describe('roadmap help', () => {
  it('follows the help convention', () => {
    expectSkillHelp(dir);
  });

  it('covers approval, milestones and ROADMAP.md markers', () => {
    for (const s of ['approval', 'M<n>', 'github-milestone', 'roadmap:begin', 'grill-me']) {
      expect(help).toContain(s);
    }
  });

  it('keeps SKILL.md within 100 lines', () => {
    const lines = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8').trimEnd().split('\n');
    expect(lines.length).toBeLessThanOrEqual(100);
  });
});
