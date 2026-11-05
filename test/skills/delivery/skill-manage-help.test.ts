import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { expectSkillHelp } from '../../helpers/skill-help';

const skillDir = path.resolve(__dirname, '../../../skills/delivery/skill-manage');
const help = fs.readFileSync(path.join(skillDir, 'references/help.md'), 'utf8');
const groups = JSON.parse(
  fs.readFileSync(path.join(skillDir, 'scripts/groups.json'), 'utf8'),
) as Record<string, string[]>;

describe('skill-manage help', () => {
  it('follows the help convention', () => {
    expectSkillHelp(skillDir);
  });

  it('covers dry-run, presets, -g, packs and update', () => {
    for (const term of [
      'dry-run',
      '`core`',
      '`all`',
      '-g',
      'angular/skills',
      'dotnet/skills',
      'npx skills update',
    ]) {
      expect(help).toContain(term);
    }
  });

  it('names every installable group of groups.json except skill-tooling', () => {
    for (const g of Object.keys(groups).filter((g) => !['skill-tooling', 'obsolete'].includes(g))) {
      expect(help).toContain(`\`${g}\``);
    }
  });

  it('keeps SKILL.md within 100 lines', () => {
    const lines = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8').trimEnd().split('\n');
    expect(lines.length).toBeLessThanOrEqual(100);
  });
});
