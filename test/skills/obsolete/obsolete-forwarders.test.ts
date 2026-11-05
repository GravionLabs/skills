import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const installer = fs.readFileSync(
  path.join(root, 'skills/delivery/skills-manage/scripts/Install-Skills.ps1'),
  'utf8',
);
const groups = JSON.parse(
  fs.readFileSync(path.join(root, 'skills/delivery/skills-manage/scripts/groups.json'), 'utf8'),
) as Record<string, string[]>;

describe.each(['skills-install', 'skill-manage'])('obsolete %s forwarder', (name) => {
  const skillDir = path.join(root, 'skills/obsolete', name);
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');

  it('names skills-manage and its install command', () => {
    expect(skill).toContain('npx skills add GravionLabs/skills --skill skills-manage');
    expect(skill).toContain('/skills-manage');
  });

  it('is not auto-invocable', () => {
    expect(skill).toMatch(/^disable-model-invocation: true$/m);
    expect(skill).toMatch(/^\s+opencode\/autoinvoke: 'false'$/m);
  });

  it('ships no scripts, templates or groups.json', () => {
    const entries = fs.readdirSync(skillDir).filter((e) => e !== 'SKILL.md' && e !== 'references');
    expect(entries).toEqual([]);
  });

  it('keeps obsolete out of both presets and the valid group names', () => {
    expect(groups).toHaveProperty('obsolete', ['skill-manage', 'skills-install']);
    expect(installer).toContain(
      "all  = @($groupMap.Keys | Where-Object { $_ -notin @('skill-tooling', 'obsolete') } | Sort-Object)",
    );
    expect(installer).toContain("core = @('shared', 'github', 'delivery', 'statusline')");
    expect(installer).toContain(
      "$valid = @($groupMap.Keys | Where-Object { $_ -notin @('skill-tooling', 'obsolete') })",
    );
  });
});
