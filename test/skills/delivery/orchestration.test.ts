import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROLES, TIERS } from '../../../skills/delivery/deliver/scripts/resolve-model.mts';

const skill = path.resolve(import.meta.dirname, '../../../skills/delivery/deliver');
const read = (file: string) =>
  readFileSync(path.join(skill, file), 'utf8').replaceAll('\r\n', '\n');
const reference = read('references/orchestration.md');
const template = /```text\n([\s\S]*?)\n```/.exec(reference)?.[1] ?? '';

// the second column of the role table
const tableRoles = [...reference.matchAll(/^\|[^|`]+\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]!);
// the "- <start>: <role> [--tier <t>]" lines of the start prompt template
const promptStarts = [...template.matchAll(/^- [^:\n]+: (\S+)(?: --tier (\w+))?/gm)];

describe('deliver references/orchestration.md', () => {
  it('is linked from SKILL.md', () => {
    expect(read('SKILL.md')).toContain('](references/orchestration.md)');
  });

  it('names only roles of the resolver in the role table', () => {
    expect(tableRoles).toEqual(['implement', 'review', 'release', 'planner', 'implement']);
    for (const role of tableRoles) expect(ROLES).toContain(role);
  });

  it('carries the role of every table row in the start prompt template', () => {
    expect(promptStarts.map((m) => m[1])).toEqual(tableRoles);
    for (const tier of promptStarts.flatMap((m) => m[2] ?? [])) expect(TIERS).toContain(tier);
    expect(template).toContain('resolve-model.mts <role>');
    expect(template).toContain('start_agent');
  });
});
