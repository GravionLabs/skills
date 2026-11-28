import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const delivery = path.resolve(import.meta.dirname, '../../../skills/delivery');
const skill = readFileSync(path.join(delivery, 'host-poimen/SKILL.md'), 'utf8').replaceAll(
  '\r\n',
  '\n',
);

describe('host-poimen', () => {
  it.each(['start_agent', 'worktree', 'wait_any', 'read_agent', 'report_done', 'prompt_agent'])(
    'names %s',
    (name) => {
      expect(skill).toContain(name);
    },
  );

  it('links the verb contract', () => {
    expect(skill).toContain('](../deliver/references/host-verbs.md)');
  });

  it.each([
    'Split only independent parts',
    'One worktree per worker',
    'Brief each worker completely',
    'Never poll',
    'Verify a report yourself',
    'Ask the owner before more than a few workers',
    'Never end or take over a worker',
  ])('has the lead rule "%s"', (rule) => {
    const leading = skill.split(/^## /m).find((s) => s.startsWith('Leading workers\n'));
    expect(leading).toContain(rule);
  });

  it.each([
    'split this across agents in poimen',
    'start workers in poimen',
    'orchestrate agents in poimen',
  ])('triggers on "%s"', (prompt) => {
    expect(skill.match(/^description: .*$/m)?.[0]).toContain(prompt);
  });

  it('passes the model of the resolver to every start', () => {
    expect(skill).toContain('resolve-model.mts <role>');
  });
});
