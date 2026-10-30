import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const skillDir = path.resolve(__dirname, '../../../skills/github-issue');
const read = (rel: string): string => readFileSync(path.join(skillDir, rel), 'utf8');

describe('github-issue level-prefixed titles', () => {
  const skill = read('SKILL.md');
  const section = skill.slice(skill.indexOf('## Issue Types'), skill.indexOf('## Routing'));

  it('lists every level prefix in the Issue Types table', () => {
    for (const prefix of ['[Epic] ', '[Feature] ', '[PBI] ', '[Task] ', '[Bug] ']) {
      expect(section).toContain(prefix);
    }
  });

  it('drops the unprefixed conventions', () => {
    expect(section).not.toContain('Conventional commit: ');
    expect(skill).not.toContain('title conventions vary');
  });

  it('keeps legacy forms read-only', () => {
    expect(section).toContain('never written');
  });

  it('names the prefix strip in the slug rule and in conventional-commits', () => {
    expect(skill).toMatch(/slug.*stripping/);
    const cc = read('references/conventional-commits.md');
    expect(cc).toContain('stripping the level prefix');
    expect(cc).toContain('`[Bug] fix: x` → `fix/<nr>-x`');
  });

  it('keeps PR titles without level prefix and task titles prefixed', () => {
    expect(read('references/standalone-issue.md')).toContain('the skill owns title and footer');
    expect(
      readFileSync(
        path.resolve(__dirname, '../../../skills/github-pull-request/SKILL.md'),
        'utf-8',
      ),
    ).toContain('`<type>: <description> (#<issue_number>)`');
    expect(read('references/task-issues.md')).toContain('`[Task] <conventional title>`');
  });

  it('takes the PR title from the issue title word for word (#859)', () => {
    const pr = readFileSync(
      path.resolve(__dirname, '../../../skills/github-pull-request/SKILL.md'),
      'utf-8',
    );
    const step = pr.slice(pr.indexOf('2. **Title**'), pr.indexOf('3. **Body**'));
    expect(step).toContain('keep type, scope and summary word for word');
    expect(step).toContain(
      '`[PBI] feat(adapters): read the subagents of Claude Code workflows` → `feat(adapters): read the subagents of Claude Code workflows (#436)`',
    );
    expect(step).not.toContain('60 chars');
    const deliver = readFileSync(
      path.resolve(__dirname, '../../../skills/deliver/SKILL.md'),
      'utf-8',
    );
    expect(deliver).toContain(
      'its title is the issue title without the level prefix, `(#<nr>)` appended',
    );
  });
});
