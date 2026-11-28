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

  it('passes the model of the resolver to every start', () => {
    expect(skill).toContain('resolve-model.mts <role>');
  });
});
