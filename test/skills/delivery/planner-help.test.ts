import * as fs from 'fs';
import * as path from 'path';
import { expectSkillHelp } from '../../helpers/skill-help';

const dir = path.resolve(__dirname, '../../../skills/delivery/planner');
const help = fs.readFileSync(path.join(dir, 'references/help.md'), 'utf-8');

describe('planner help', () => {
  it('follows the help convention', () => {
    expectSkillHelp(dir);
  });

  it('covers modes, depths, output levels, split approval and governance', () => {
    for (const s of [
      'refine <nr>',
      'quick',
      'standard',
      'deep',
      'Epic',
      'Feature',
      'sibling PBIs',
      'approval',
      'governance',
    ]) {
      expect(help).toContain(s);
    }
  });

  it('keeps SKILL.md within 100 lines', () => {
    const lines = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8').trimEnd().split('\n');
    expect(lines.length).toBeLessThanOrEqual(100);
  });
});
