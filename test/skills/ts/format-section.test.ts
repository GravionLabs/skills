import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const skill = readFileSync(
  path.resolve(__dirname, '../../../skills/ts/ts-implementation/SKILL.md'),
  'utf8',
);
const section = /^## Format$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(skill)?.[1] ?? '';
const lines = section.split('\n').filter((l) => l.trim());
const line = (label: string): string => lines.find((l) => l.startsWith('- ' + label)) ?? '';

describe('ts-implementation ## Format', () => {
  it('has the section with extensions', () => {
    expect(section).not.toBe('');
    expect(line('Extensions:')).toMatch(/`\.[a-z]+/);
  });
  it('names a format and a check command with {files}', () => {
    expect(line('Format:')).toContain('{files}');
    expect(line('Check (read-only):')).toContain('{files}');
  });
  it('calls the script with -Language ts only and points to format.md', () => {
    const calls = lines.filter((x) => x.includes('Format-Changed.ps1'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('Format-Changed.ps1 -Language ts`');
    expect(calls[0]).not.toContain('-Extensions');
    expect(calls[0]).not.toContain('-Command');
    expect(calls[0]).toContain('references/format.md');
  });
  // 6 while the Biome and the oxc line both exist; back to 5 when the last Biome repository is migrated (ADR 0006)
  it('stays within 6 lines and 100 lines of skill', () => {
    expect(lines.length).toBeLessThanOrEqual(6);
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });
  it('no longer repeats the shared override text', () => {
    expect(section).not.toContain('.agents/format.json');
    expect(section).not.toContain('-Requires');
  });
});
