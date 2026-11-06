import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const skillDir = path.resolve(__dirname, '../../../skills/delivery/skills-manage');
const read = (p: string) => fs.readFileSync(path.join(skillDir, p), 'utf8');
const skill = read('SKILL.md');
const afterInstall = read('references/after-install.md');
const help = read('references/help.md');
const groups = read('scripts/groups.json');
const installer = read('scripts/Install-Skills.ps1');

describe('skills-manage offers project-setup after an install', () => {
  it('SKILL.md asks after a project install only and delegates', () => {
    const step = skill.split('\n').find((l) => l.startsWith('6.')) ?? '';
    expect(step).toContain('not `-g`');
    expect(step).toContain('ask');
    expect(step).toContain('`/project-setup`');
    expect(step).toContain('Never run it unasked');
  });

  it('SKILL.md stays within 100 lines', () => {
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });

  it('after-install.md and help mention the offer', () => {
    expect(afterInstall).toContain('## project-setup offer');
    expect(help).toContain('/project-setup');
  });

  it('project-setup is in shared, and core and all contain shared', () => {
    const shared = JSON.parse(groups) as unknown;
    expect(JSON.stringify(shared)).toContain('"project-setup"');
    expect(installer).toMatch(/core = @\([^)]*'shared'/);
    expect(installer).toContain('$groupMap.Keys');
  });
});
