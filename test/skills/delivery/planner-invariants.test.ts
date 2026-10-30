import * as fs from 'fs';
import * as path from 'path';

const pk = path.resolve(__dirname, '../../../skills');
const read = (p: string) => fs.readFileSync(path.join(pk, p), 'utf-8');
const skillDir = 'planner';

describe('planner invariants section (#484)', () => {
  const ref = read(`${skillDir}/references/invariants.md`);
  const skill = read(`${skillDir}/SKILL.md`);

  it('invariants.md holds the five checklist items', () => {
    const items = ref
      .split('## Checklist')[1]
      .split('\n## ')[0]
      .match(/^\d\. .+$/gm)!;
    expect(items).toHaveLength(5);
    expect(items[0]).toMatch(/atomic|compensated/);
    expect(items[1]).toMatch(/error|fallback/i);
    expect(items[2]).toMatch(/timeout/);
    expect(items[3]).toMatch(/awaited/);
    expect(items[4]).toMatch(/logged/);
  });

  it('states the wording rule', () => {
    expect(ref).toMatch(/only the items that apply/);
    expect(ref).toMatch(/generic list/);
  });

  it('SKILL.md step 5 names the trigger and the reference', () => {
    const step = skill.split('\n').find((l) => l.startsWith('5. '))!;
    expect(step).toMatch(/async/);
    expect(step).toMatch(/persistence/);
    expect(step).toMatch(/state machine/);
    expect(step).toContain('references/invariants.md');
  });

  it('placement is stated for pbi, task and the single plan item', () => {
    expect(ref).toMatch(/`pbi`.*Definition of Done/);
    expect(ref).toMatch(/`task`.*agent-ready/);
    expect(ref).toMatch(/Single-task plan.*plan\.json/);
  });

  it('PBI template ends with Definition of Done, where invariants.md places the section before', () => {
    const tpl = fs.readFileSync(
      path.resolve(__dirname, '../../../.github/ISSUE_TEMPLATE/pbi.md'),
      'utf-8',
    );
    const headings = tpl.match(/^## .+$/gm)!;
    expect(headings[headings.length - 1]).toBe('## Definition of Done');
  });

  it('task-issues.md template orders Implementation Notes, Invariants, agent-ready block', () => {
    const t = read('github-issue/references/task-issues.md');
    const notes = t.indexOf('## Implementation Notes');
    const inv = t.indexOf('## Invariants');
    const block = t.indexOf('<!-- agent-ready:start -->');
    expect(notes).toBeGreaterThan(-1);
    expect(inv).toBeGreaterThan(notes);
    expect(block).toBeGreaterThan(inv);
    expect(t).toMatch(/omit this heading when no invariant applies/);
  });

  it('plan-schema.md body row mentions the optional section', () => {
    const row = read(`${skillDir}/references/plan-schema.md`)
      .split('\n')
      .find((l) => l.startsWith('| `items[].body`'))!;
    expect(row).toContain('## Invariants');
  });

  it('implementation checklist requires a test per Invariants item', () => {
    const skill = read('implementation/SKILL.md');
    const section = skill.split('## Before commit')[1].split('\n## ')[0];
    expect(section).toMatch(/- \[ \] .*Invariants.*\btest\b/);
  });
});
