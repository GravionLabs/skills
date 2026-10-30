import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const skill = readFileSync(
  path.resolve(__dirname, '../../../skills/go/go-implementation/SKILL.md'),
  'utf8',
);
const section = /^## Format$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(skill)?.[1] ?? '';
const lines = section.split('\n').filter((l) => l.trim());
const line = (label: string): string => lines.find((l) => l.startsWith('- ' + label)) ?? '';

describe('go-implementation ## Format', () => {
  it('has the section with extensions', () => {
    expect(line('Extensions:')).toContain('`.go`');
  });
  it('names a format and a check command with {files}', () => {
    expect(line('Format:')).toContain('gofmt -w {files}');
    expect(line('Check (read-only):')).toContain('gofmt -l {files}');
  });
  it('calls the script with -Language go only', () => {
    const calls = lines.filter((x) => x.includes('Format-Changed.ps1'));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('Format-Changed.ps1 -Language go`');
  });
});

describe('go skills structure', () => {
  it('go-implementation has Review rules and stays within 100 lines', () => {
    expect(skill).toMatch(/^## Review rules$/m);
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });
});
