import * as fs from 'fs';
import * as path from 'path';

const dir = path.resolve(__dirname, '../../../skills/delivery/planner');
const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
const ready = fs.readFileSync(path.join(dir, 'references/ready.md'), 'utf-8');
const governance = fs.readFileSync(path.join(dir, 'references/governance.md'), 'utf-8');
const issueDecisions = fs.readFileSync(
  path.resolve(__dirname, '../../../skills/github/github-issue/references/decisions.md'),
  'utf-8',
);

const steps = skill.split('## Steps\n')[1].split('\n## ')[0];
const step5 = steps.split('\n').find((l) => l.startsWith('5. ')) ?? '';
const refine = skill.split('\n## Refine\n')[1].split('\n## ')[0];

const ADR_CRITERION = 'ADR (the next free ADR number) with Status: Proposed';
const SPEC_CRITERION = 'spec updated or `no spec change needed: <spec>` noted';

describe('planner governance (#86)', () => {
  it('SKILL.md has one pointer to governance.md in Steps 5 and in Refine', () => {
    expect(step5).toMatch(/`governance`[\s\S]*references\/governance\.md/);
    expect(refine).toMatch(/`governance`[\s\S]*references\/governance\.md/);
    expect(skill.split('references/governance.md').length - 1).toBe(2);
  });

  it('SKILL.md stays within 100 lines', () => {
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });

  it('ready.md carries the governance pointer line', () => {
    expect(ready).toContain('with `governance`: also `references/governance.md`');
  });

  it('without governance the reference is conditional and the rest is unchanged', () => {
    expect(governance).toMatch(/Loaded only when `\.agents\/config\.json` has `governance`/);
    expect(governance).toMatch(/Without it[\s\S]*unchanged/);
  });

  it('decision PBI rule: triggers, title, label, criterion and blocking', () => {
    expect(governance).toMatch(/adrPaths/);
    expect(governance).toMatch(/adds a service/);
    expect(governance).toMatch(/adds an external dependency/);
    expect(governance).toMatch(/reverses an accepted ADR/);
    expect(governance).toContain('`docs: ADR <topic>`');
    expect(governance).toContain('label `needs-decision`');
    expect(governance).toContain(`\`${ADR_CRITERION}\``);
    expect(governance).toMatch(/blocked_by`/);
    expect(governance).toMatch(/never a fixed ADR number/);
  });

  it('ADR criterion wording is the same as github-issue decisions.md', () => {
    expect(issueDecisions).toContain(ADR_CRITERION);
    expect(governance).toContain(ADR_CRITERION);
  });

  it('decisions: grill-me first, answers under ## Decisions, ADR stays Proposed', () => {
    expect(governance).toMatch(/grill-me` first/);
    expect(governance).toMatch(/## Decisions/);
    expect(governance).toMatch(/still carries `Status: Proposed`/);
  });

  it('spec criterion wording and spec file named in the body', () => {
    expect(governance).toMatch(/specMap/);
    expect(governance).toMatch(/Spec: <specDir>\/<name>\.md/);
    expect(governance).toContain(`- [ ] ${SPEC_CRITERION}`);
    expect(governance).toContain('no spec change needed:');
  });

  it('readiness: a PBI under adrPaths without ADR criterion or blocking decision is not ready', () => {
    expect(governance).toMatch(
      /under `adrPaths`[\s\S]*without[\s\S]*ADR[\s\S]*blocking decision PBI[\s\S]*not ready/,
    );
  });
});
