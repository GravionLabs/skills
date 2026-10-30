import * as fs from 'fs';
import * as path from 'path';

const pk = path.resolve(__dirname, '../../../skills');
const read = (p: string) => fs.readFileSync(path.join(pk, p), 'utf-8');
const skillDir = 'delivery/planner';

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

  it('places the section in the PBI body only (#890)', () => {
    const placement = ref.slice(ref.indexOf('## Placement'));
    expect(placement).toMatch(/PBI body only.*Definition of Done/);
    expect(placement).not.toMatch(/`task`|Task body|agent-ready/);
  });

  it('PBI template ends with Definition of Done, where invariants.md places the section before', () => {
    const tpl = fs.readFileSync(
      path.resolve(__dirname, '../../../.github/ISSUE_TEMPLATE/pbi.md'),
      'utf-8',
    );
    const headings = tpl.match(/^## .+$/gm)!;
    expect(headings[headings.length - 1]).toBe('## Definition of Done');
  });

  it('has no Task issue template any more (#890)', () => {
    expect(fs.existsSync(path.join(pk, 'github/github-issue/references/task-issues.md'))).toBe(
      false,
    );
  });

  it('plan-schema.md body row mentions the optional section', () => {
    const row = read(`${skillDir}/references/plan-schema.md`)
      .split('\n')
      .find((l) => l.startsWith('| `items[].body`'))!;
    expect(row).toContain('## Invariants');
  });

  it('implementation checklist requires a test per Invariants item', () => {
    const skill = read('shared/implementation/SKILL.md');
    const section = skill.split('## Before commit')[1].split('\n## ')[0];
    expect(section).toMatch(/- \[ \] .*Invariants.*\btest\b/);
  });
});
