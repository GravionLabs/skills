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
    for (const s of ['approval', 'M<nnn>', 'github-milestone', 'roadmap:begin', 'grill-me']) {
      expect(help).toContain(s);
    }
  });

  it('plans Features only (ADR 0010)', () => {
    expect(help).toMatch(/PBIs and Bugs are never assigned/);
    expect(help).toContain('unplanned, ships at merge');
    const proposal = fs.readFileSync(path.join(dir, 'references/proposal.md'), 'utf-8');
    expect(proposal).toMatch(/with several for the latest of them/);
    expect(proposal).toMatch(/size and blockers count towards that Feature/);
  });

  it('keeps SKILL.md within 100 lines', () => {
    const lines = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8').trimEnd().split('\n');
    expect(lines.length).toBeLessThanOrEqual(100);
  });
});
