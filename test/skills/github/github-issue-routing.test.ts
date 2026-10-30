import { readFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const skills = path.resolve(__dirname, '../../../skills');
const read = (rel: string): string => readFileSync(path.join(skills, rel), 'utf8');

describe('github-issue without batch routing', () => {
  const skill = read('github-issue/SKILL.md');
  const routing = skill.slice(skill.indexOf('## Routing'), skill.indexOf('## Shared constraints'));

  it('has no batch-workflow reference file or mention', () => {
    expect(existsSync(path.join(skills, 'github-issue/references/batch-workflow.md'))).toBe(false);
    expect(skill).not.toMatch(/batch/i);
    expect(read('github-issue/references/task-issues.md')).not.toContain('batch-workflow');
  });

  it('routing has no batch row and keeps one issue per session', () => {
    expect(routing).not.toMatch(/batch|sequentially/i);
    expect(skill).toContain('One issue per session');
  });

  it('does not point at the package-level issue-templates directory', () => {
    expect(skill).not.toContain('`issue-templates/`');
    expect(skill).toContain('.github/ISSUE_TEMPLATE/');
  });
});

describe('github-pull-request reviewer is opt-in', () => {
  const skill = read('github-pull-request/SKILL.md');
  const step = skill.split('\n').find((l) => l.startsWith('5. '))!;

  it('requests no reviewer unless the caller asks for one', () => {
    expect(skill).toContain('`add_reviewer` (default: false)');
  });

  it('uses only gh pr edit, without the REST fallback that never requested a reviewer', () => {
    expect(step).toContain('gh pr edit <pr> --add-reviewer @copilot');
    expect(step).not.toContain('requested_reviewers');
  });

  it('continues with "reviewer not added" on failure', () => {
    expect(step).toContain('reviewer not added');
    expect(step).toMatch(/never fails the PR creation/);
  });
});

describe('github-issue creates issues from a plan with blocked-by links', () => {
  const skill = read('github-issue/SKILL.md');
  const routing = skill.slice(skill.indexOf('## Routing'), skill.indexOf('## Shared constraints'));
  const planning = path.resolve(__dirname, '../../../skills/planner');

  it('routes a plan from planner to create-from-plan.md', () => {
    expect(routing).toContain(
      'A plan from `planner` (`plan.json`) → `references/create-from-plan.md`',
    );
  });

  it('create-from-plan.md exists, stays within 60 lines and sets blocked_by links', () => {
    const doc = read('github-issue/references/create-from-plan.md');
    expect(doc.trimEnd().split('\n').length).toBeLessThanOrEqual(60);
    expect(doc).toContain('questions[]');
    expect(doc).toContain('--body-file -');
    expect(doc).toContain('blocked_by');
  });

  it('sub-issues.md documents the add, read and remove calls with the database id', () => {
    const doc = read('github-issue/references/sub-issues.md');
    expect(doc).toContain('## Blocked-by links');
    expect(doc).toContain(
      'gh api -X POST repos/{owner}/{repo}/issues/<nr>/dependencies/blocked_by -F issue_id=$blockerId',
    );
    expect(doc).toContain('gh api repos/{owner}/{repo}/issues/<nr>/dependencies/blocked_by --jq');
    expect(doc).toContain(
      'gh api -X DELETE repos/{owner}/{repo}/issues/<nr>/dependencies/blocked_by/$blockerId',
    );
    expect(doc).toContain('gh api repos/{owner}/{repo}/issues/<blocker-nr> --jq .id');
  });

  it('every file task-issues.md and planner name for blocked-by links contains "blocked_by"', () => {
    const sources = [
      read('github-issue/references/task-issues.md'),
      readFileSync(path.join(planning, 'SKILL.md'), 'utf8'),
      ...readdirSync(path.join(planning, 'references'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => readFileSync(path.join(planning, 'references', f), 'utf8')),
    ];
    const named = new Set(
      sources
        .flatMap((s) => s.split('\n'))
        .filter((l) => /blocked-by links?/i.test(l))
        .flatMap((l) => [...l.matchAll(/`(?:references\/)?([\w-]+\.md)`/g)].map((m) => m[1])),
    );
    expect([...named]).toContain('sub-issues.md');
    for (const file of named) {
      expect(read(`github-issue/references/${file}`), file).toContain('blocked_by');
    }
  });
});
