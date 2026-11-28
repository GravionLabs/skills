import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { expectSkillHelp } from '../../helpers/skill-help';

const delivery = path.resolve(import.meta.dirname, '../../../skills/delivery');
const dir = path.join(delivery, 'deliver-lead');
const read = (file: string) =>
  readFileSync(path.join(delivery, file), 'utf8').replaceAll('\r\n', '\n');
const skill = read('deliver-lead/SKILL.md');
const leaf = read('deliver-lead/references/leaf.md');
const help = read('deliver-lead/references/help.md');

const section = (text: string, heading: string) =>
  text.split(/^## /m).find((s) => s.startsWith(`${heading}\n`)) ?? '';
const rowIds = (text: string) => [...text.matchAll(/^\|\s*`([^`]+)`\s*\|/gm)].map((m) => m[1]!);
const verbs = rowIds(section(read('deliver/references/host-verbs.md'), 'Verbs'));

// the tool names of the hosts, which only the adapters may use
const HOST_TOOLS = [
  'start_agent',
  'wait_any',
  'wait_agent',
  'read_agent',
  'prompt_agent',
  'report_done',
  'whoami',
  'record_run',
  'Agent',
  'SendMessage',
  'AskUserQuestion',
  'run_in_background',
  'worker-start',
  'worker-read',
  'worker_done',
];

describe('deliver-lead skill', () => {
  it('is loadable by a lead, triggers on lead requests and is within 100 lines', () => {
    // a tree lead briefs a leaf lead with `/deliver-lead <issue>`: a skill loaded by name is never gated
    expect(skill).not.toContain('disable-model-invocation');
    expect(skill).not.toContain('autoinvoke');
    expect(skill).toMatch(/^description: .*lead the delivery.*Not for implementing/m);
    expect(skill.trimEnd().split('\n').length).toBeLessThanOrEqual(100);
  });

  it('follows the help convention', () => {
    expectSkillHelp(dir);
  });

  it('routes PBI and Bug to the leaf flow and names the three adapters', () => {
    expect(skill).toMatch(/\| PBI, Bug +\|.*references\/leaf\.md/);
    expect(skill).toContain('GravionLabs/skills#1143');
    for (const host of ['host-poimen', 'host-orca', 'host-claude-code']) {
      expect(skill).toContain(`\`${host}\``);
      expect(existsSync(path.join(delivery, host, 'SKILL.md'))).toBe(true);
    }
  });

  it('has a row for every host verb and for end in leaf.md', () => {
    // the first row is the header
    expect(rowIds(section(leaf, 'Actions')).slice(1)).toEqual([...verbs, 'end']);
  });

  it('names in leaf.md only verbs of host-verbs.md', () => {
    // every hyphenated word in backticks is a verb id
    const named = [...leaf.matchAll(/`([a-z]+(?:-[a-z]+)+)`/g)].map((m) => m[1]!);
    expect(named.length).toBeGreaterThan(0);
    expect(named.filter((name) => !verbs.includes(name))).toEqual([]);
  });

  it.each(HOST_TOOLS)('does not name the host tool %s', (tool) => {
    for (const text of [skill, leaf, help])
      expect(text).not.toMatch(new RegExp(`(?<![\\w-])${tool}(?![\\w-])`));
  });

  it('names only scripts that exist', () => {
    const named = [skill, leaf, help].flatMap((text) => [
      ...text.matchAll(/(<deliver-skill-dir>\/|<skill-dir>\/)?\b(scripts\/[\w./-]+\.(?:mts|ps1))/g),
    ]);
    expect(named.length).toBeGreaterThan(0);
    for (const [, prefix, file] of named) {
      const owner = prefix === '<deliver-skill-dir>/' ? 'deliver' : 'deliver-lead';
      expect(existsSync(path.join(delivery, owner, file!)), `${owner}/${file}`).toBe(true);
    }
  });

  it('is linked from host-verbs.md', () => {
    const reference = read('deliver/references/host-verbs.md');
    expect(reference).toContain('](../../deliver-lead/SKILL.md)');
    expect(reference).not.toContain('planned');
  });
});
