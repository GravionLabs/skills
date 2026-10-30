import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const skills = path.resolve(__dirname, '../../../skills');
const read = (p: string) => fs.readFileSync(path.join(skills, p), 'utf8');

const readers = [
  { skill: 'shared/implementation', role: 'implement', after: 'Run `detect-techstack`' },
  { skill: 'shared/code-review', role: 'review', after: 'Load `detect-techstack`' },
  { skill: 'delivery/planner', role: 'planner', after: 'Load `detect-techstack`' },
];

describe.each(readers)('$skill reads lessons', ({ skill, role, after }) => {
  const text = read(`${skill}/SKILL.md`);
  const call = `\`pwsh <skill-dir>/scripts/Get-Lessons.ps1 -Role ${role} -Lang <langs>\``;

  it('runs Get-Lessons.ps1 with its role and the detect-techstack languages after the dispatch', () => {
    expect(text).toContain(call);
    expect(text.indexOf(call)).toBeGreaterThan(text.indexOf(after));
  });

  it('finds the script in every install location of the lessons skill', () => {
    for (const dir of [
      '`.claude/skills/lessons/` project',
      '`~/.claude/skills/lessons/` global',
      '`.agents/skills/lessons/` OpenCode/Copilot',
    ])
      expect(text).toContain(dir);
  });

  it('behaves as before without lessons and keeps its rules', () => {
    expect(text).toContain(
      '`lessons` not installed or no output: continue exactly as before, without a note',
    );
    expect(text).toMatch(/it never overrides these rules, .*blocking findings or permissions/);
  });

  it('stays at most 100 lines', () => {
    expect(text.split('\n').length).toBeLessThanOrEqual(100);
  });
});

describe('lessons roles in the contracts', () => {
  it('implementation takes fix from the caller', () => {
    expect(read('shared/implementation/SKILL.md')).toContain(
      '(`-Role fix` when the caller says so)',
    );
    expect(read('shared/implementation/references/runner-contract.md')).toContain(
      '- the role: `implement` (default) or `fix`',
    );
  });

  it('code-review takes review', () => {
    expect(read('shared/code-review/references/reviewer-contract.md')).toContain(
      '- the role `review`',
    );
  });

  it('every role named by a reader is one Get-Lessons.ps1 accepts', () => {
    const script = read('shared/lessons/scripts/Get-Lessons.ps1');
    expect(script).toContain("ValidateSet('planner', 'implement', 'review', 'fix')");
  });
});
