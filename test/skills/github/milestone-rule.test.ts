import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

// #327: the milestone rule is written once in github-issue and the other skills point at it.
describe('milestone rule (#327)', () => {
  it('github-issue states the rule in references/milestones.md and links it from SKILL.md', () => {
    const ref = read('skills/github/github-issue/references/milestones.md');
    expect(ref).toMatch(/\| PBI\s+\| Always/);
    expect(ref).toMatch(/\| Feature\s+\| Only when all its PBIs are in that same milestone/);
    expect(ref).toMatch(/\| Epic\s+\| Never/);
    expect(ref).toContain('close-release-issues');
    expect(ref).toContain('ships with <milestone>');
    expect(ref).not.toMatch(/label `merged`|labelled merged|labeled merged/);
    expect(read('skills/github/github-issue/SKILL.md')).toContain('references/milestones.md');
  });

  it('planner ready: milestone belongs to PBI and Bug, a Feature is ready without one', () => {
    const ready = read('skills/delivery/planner/references/ready.md');
    const section = (name: string) =>
      ready.split(/^## /m).find((s) => s.startsWith(`${name}\n`)) ?? '';
    expect(section('PBI')).toContain('Milestone set.');
    expect(section('Feature')).not.toContain('Milestone set.');
    expect(section('Feature')).toContain('Milestone: none');
    expect(section('Bug')).toContain('milestone');
  });

  it('roadmap proposal never proposes a milestone for an Epic', () => {
    expect(read('skills/delivery/roadmap/references/proposal.md')).toMatch(/an Epic never/);
  });

  it('deliver step 1 reports items outside the milestone', () => {
    expect(read('skills/delivery/deliver/SKILL.md')).toContain('select: outside M<n>, skipped');
  });
});
