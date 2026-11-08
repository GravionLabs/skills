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

  it('setting a milestone: only github-milestone assign, no skill file edits it with gh issue edit', () => {
    const ref = read('skills/github/github-issue/references/milestones.md');
    const section = ref.split(/^## /m).find((x) => x.startsWith('Setting a milestone\n')) ?? '';
    expect(section).toContain('github-milestone assign M<n>|none #<nr>');
    expect(section).toMatch(/--milestone/);
    expect(section).toMatch(/--remove-milestone/);
    expect(ref.split(/^## /m).find((x) => x.startsWith('Checks\n')) ?? '').toContain('assign');

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.md')) files.push(p);
      }
    };
    walk(path.join(root, 'skills'));
    expect(files.length).toBeGreaterThan(0);
    // Scripts (Get-Milestones.ps1 implements assign, close and insert) are out of scope: skill files only.
    // A line that forbids the call ("never", "instead of", "not used") is prose, not a call.
    const call = /gh issue edit\b[^\n`]*--(remove-)?milestone\b/;
    const prohibition = /never|instead of|not used|not by hand/i;
    const offenders = files.filter((f) =>
      fs
        .readFileSync(f, 'utf8')
        .split('\n')
        .some((line) => call.test(line) && !prohibition.test(line)),
    );
    expect(offenders.map((f) => path.relative(root, f))).toEqual([]);
    expect(read('skills/github/github-issue/SKILL.md')).toContain('github-milestone assign');
    expect(read('skills/delivery/planner/SKILL.md')).toContain('github-milestone assign');
    expect(read('skills/github/github-issue/references/create-from-plan.md')).toContain(
      'github-milestone assign',
    );
    expect(read('docs/guides/release.md')).toContain('/github-milestone assign');
  });
});
