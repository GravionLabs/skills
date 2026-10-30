import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const skills = path.resolve(__dirname, '../../../skills');
const read = (rel: string): string => readFileSync(path.join(skills, rel), 'utf8');

const FORBIDDEN_KEYS = ['compatibility', 'chronicle-hints', 'model', 'allowed-tools'];
const lines = (rel: string): string[] => read(rel).split('\n');
const namesAll = (line: string, keys: string[]): boolean =>
  keys.every((k) => line.includes(`\`${k}\``));

describe('skill-tooling enforces the skill frontmatter convention', () => {
  it.each([
    [
      'skill-tooling/skill-write/references/skill-writing-rules.md',
      /Forbidden top-level keys \(🔴\)/,
    ],
    ['skill-tooling/skill-write/SKILL.md', /Never .* at top level/],
  ])('%s lists every forbidden key on its forbidden-key rule line', (file, rule) => {
    const line = lines(file).find((l) => rule.test(l));
    expect(line, `${file} has no forbidden-key rule line`).toBeDefined();
    for (const key of FORBIDDEN_KEYS) {
      expect(line, `${file} rule line lacks \`${key}\``).toContain(`\`${key}\``);
    }
  });

  it.each([
    'skill-tooling/skill-audit/references/audit-checklist.md',
    'skill-tooling/skill-audit/SKILL.md',
  ])('%s rates every forbidden top-level key critical', (file) => {
    const line = lines(file).find((l) => namesAll(l, FORBIDDEN_KEYS));
    expect(line, `${file} has no line naming all forbidden keys`).toBeDefined();
    expect(line).toContain('🔴');
  });

  it('skill-audit checklist recommends moving annotations to metadata', () => {
    const line = lines('skill-tooling/skill-audit/references/audit-checklist.md').find((l) =>
      namesAll(l, FORBIDDEN_KEYS),
    );
    expect(line).toMatch(/recommendation: remove, or move annotations to `metadata:`/);
  });

  it('skill-write template frontmatter has only name and description', () => {
    const text = read('skill-tooling/skill-write/assets/skill-template-optimized.md');
    const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
    expect(match).not.toBeNull();
    const keys = [...match![1].matchAll(/^([A-Za-z][\w/-]*):/gm)].map((m) => m[1]);
    expect(keys).toEqual(['name', 'description']);
  });

  it('skill-write sends chronicle-hints to metadata', () => {
    expect(read('skill-tooling/skill-write/references/skill-writing-rules.md')).toMatch(
      /`chronicle-hints` \(move to `metadata:`\)/,
    );
    expect(read('skill-tooling/skill-write/SKILL.md')).toMatch(
      /`chronicle-hints` at top level; annotations go under `metadata`/,
    );
  });

  it('no skill-tooling skill references the stale skill-size-validator.ts', () => {
    for (const file of [
      'skill-tooling/skill-write/SKILL.md',
      'skill-tooling/skill-write/references/skill-writing-rules.md',
      'skill-tooling/skill-audit/SKILL.md',
      'skill-tooling/skill-audit/references/audit-checklist.md',
      'skill-tooling/skill-slim/SKILL.md',
    ]) {
      expect(read(file), file).not.toContain('skill-size-validator.ts');
    }
  });

  it('no skill in any package writes user-invocable: true (the default)', () => {
    const packages = path.resolve(__dirname, '../../../skills');
    const offenders: string[] = [];
    for (const pkg of readdirSync(packages)) {
      const dir = path.join(packages, pkg);
      let names: string[] = [];
      try {
        names = readdirSync(dir);
      } catch {
        continue;
      }
      for (const name of names) {
        let text: string;
        try {
          text = readFileSync(path.join(dir, name, 'SKILL.md'), 'utf8');
        } catch {
          continue;
        }
        const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
        if (/^user-invocable:\s*true\s*$/m.test(fm)) offenders.push(`${pkg}/${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
