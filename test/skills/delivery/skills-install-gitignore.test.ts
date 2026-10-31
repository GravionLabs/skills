import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const skillDir = path.resolve(__dirname, '../../../skills/delivery/skills-install');
const script = fs.readFileSync(path.join(skillDir, 'scripts/Install-Skills.ps1'), 'utf8');
const doc = fs.readFileSync(path.join(skillDir, 'references/after-install.md'), 'utf8');

describe('skills-install .gitignore note for .agents/', () => {
  it('the installer note names the !.agents/lessons/ exception', () => {
    const note = script.split('\n').find((l) => l.includes('.gitignore ignores .agents/'));
    expect(note).toBeDefined();
    expect(note).toContain('!.agents/skills/');
    expect(note).toContain('!.agents/config.json');
    expect(note).toContain('!.agents/lessons/');
  });

  it('after-install.md names the !.agents/lessons/ exception', () => {
    const line = doc.split('\n').find((l) => l.includes('`.gitignore`') && l.includes('.agents/*'));
    expect(line).toBeDefined();
    expect(line).toContain('`!.agents/lessons/`');
  });
});
