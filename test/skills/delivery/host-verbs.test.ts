import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const delivery = path.resolve(import.meta.dirname, '../../../skills/delivery');
const read = (file: string) =>
  readFileSync(path.join(delivery, file), 'utf8').replaceAll('\r\n', '\n');

const VERBS = ['start-worker', 'wait-any', 'read-result', 'answer-worker', 'ask-owner'];

const section = (text: string, heading: string) =>
  text.split(/^## /m).find((s) => s.startsWith(`${heading}\n`)) ?? '';
// the ids in backticks of the first column of the table rows
const rowIds = (text: string) => [...text.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]!);

// every skills/delivery/host-<host>/ folder is the adapter of one host
const adapters = readdirSync(delivery, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && entry.name.startsWith('host-'))
  .map((entry) => entry.name);

describe('deliver references/host-verbs.md', () => {
  const reference = read('deliver/references/host-verbs.md');

  it('names the five verbs in the verb table, in this order', () => {
    expect(rowIds(section(reference, 'Verbs'))).toEqual(VERBS);
  });

  it('is linked from SKILL.md and from the orchestration reference', () => {
    expect(read('deliver/SKILL.md')).toContain('](references/host-verbs.md)');
    expect(read('deliver/references/orchestration.md')).toContain('](host-verbs.md)');
  });

  it('has a mapping row per verb id and a Check section in every host adapter', () => {
    for (const adapter of adapters) {
      const skill = read(`${adapter}/SKILL.md`);
      expect(rowIds(skill), adapter).toEqual(expect.arrayContaining(VERBS));
      expect(skill, adapter).toMatch(/^## Check$/m);
    }
  });
});
