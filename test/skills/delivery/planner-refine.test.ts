import * as fs from 'fs';
import * as path from 'path';

const dir = path.resolve(__dirname, '../../../skills/delivery/planner');
const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
const ready = fs.readFileSync(path.join(dir, 'references/ready.md'), 'utf-8');
const refine = skill.split('\n## Refine\n')[1].split('\n## ')[0];
const section = (h: string) => ready.split(`## ${h}\n`)[1].split('\n## ')[0];

describe('planner refine definition of ready (#891)', () => {
  it('ready.md has a list per level', () => {
    expect(section('Epic')).toMatch(/Outcome[\s\S]*out of scope[\s\S]*Features as sub-issues/i);
    expect(section('Feature')).toMatch(/Acceptance criteria[\s\S]*blocked-by[\s\S]*Milestone/);
    expect(section('PBI')).toMatch(
      /Files and symbols[\s\S]*Out of scope[\s\S]*Size S or M[\s\S]*Tier:/,
    );
    expect(section('Bug')).toMatch(/repro steps or a failing test/);
  });

  it('Refine checks ready.md and grills only the gaps', () => {
    expect(refine).toContain('references/ready.md');
    expect(refine).toMatch(/gaps only/);
    expect(refine).toContain('grill-me');
  });

  it('Refine offers the plan for childless Epic/Feature and a split for size L', () => {
    expect(refine).toMatch(/Epic or Feature without children[\s\S]*## Interactive/);
    expect(refine).toMatch(/size L[\s\S]*split[\s\S]*after approval/);
  });

  it('Refine sets the labels and creates a missing one', () => {
    expect(refine).toMatch(/remove `needs-refinement`/);
    expect(refine).toMatch(/`needs-decision`[\s\S]*comment/);
    expect(refine).toMatch(/gh label create/);
  });

  it('description triggers on "refine #N"', () => {
    expect(skill.split('---')[1]).toContain('refine #N');
  });
});
