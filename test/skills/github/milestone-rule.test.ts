import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

// #327: the milestone rule is written once in github-issue and the other skills point at it.
describe('milestone rule (#327)', () => {
  it('github-issue states the rule in references/milestones.md and links it from SKILL.md', () => {
    const ref = read('skills/github/github-issue/references/milestones.md');
    expect(ref).toMatch(/\| PBI\s+\| Not planned\. Set at merge into `release\/next`/);
    expect(ref).toMatch(/\| Bug\s+\| Not planned/);
    expect(ref).toMatch(/\| Feature\s+\| Planned/);
    expect(ref).toContain('release-branch.yml');
    expect(ref).toMatch(/`release-test` .* stays there/);
    expect(ref).toMatch(/open PBIs and Bugs below those Features, plus .* before the migration/);
    expect(ref).toMatch(/\| Epic\s+\| Never/);
    expect(ref).toContain('close-release-issues');
    expect(ref).toContain('ships with <milestone>');
    expect(ref).not.toMatch(/label `merged`|labelled merged|labeled merged/);
    expect(read('skills/github/github-issue/SKILL.md')).toContain('references/milestones.md');
  });

  it('the five files link ADR 0010', () => {
    for (const file of [
      'skills/github/github-issue/SKILL.md',
      'skills/github/github-issue/references/milestones.md',
      'skills/github/github-issue/references/objectives.md',
      'skills/github/github-issue/references/create-from-plan.md',
      'skills/delivery/planner/references/ready.md',
    ])
      expect(read(file), file).toContain('docs/adr/0010-milestones-hold-features');
  });

  it('create-from-plan: a Feature gets the milestone of the plan, PBIs and Bugs none', () => {
    const doc = read('skills/github/github-issue/references/create-from-plan.md');
    expect(doc).toContain('a created Feature gets the milestone of the plan');
    expect(doc).toContain('created PBIs and Bugs get none');
  });

  it('planner ready: no milestone for PBI and Bug, a Feature is planned into one or none', () => {
    const ready = read('skills/delivery/planner/references/ready.md');
    const section = (name: string) =>
      ready.split(/^## /m).find((s) => s.startsWith(`${name}\n`)) ?? '';
    expect(section('PBI')).toContain('No milestone (set at merge).');
    expect(section('Feature')).toContain('Milestone: the release it is planned for, or none.');
    expect(section('Objective')).toContain('Requires: <owner>/<repo>#<feature>');
    expect(section('Bug')).toContain('milestone');
  });

  it('roadmap proposal never proposes a milestone for an Epic', () => {
    expect(read('skills/delivery/roadmap/references/proposal.md')).toMatch(/an Epic never/);
  });

  it('setting a milestone: only github-milestone assign, no skill file edits it with gh issue edit', () => {
    const ref = read('skills/github/github-issue/references/milestones.md');
    const section = ref.split(/^## /m).find((x) => x.startsWith('Setting a milestone\n')) ?? '';
    expect(section).toContain('github-milestone assign M<nnn>|none #<nr>');
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
    expect(read('site/guides/release.md')).toContain('/github-milestone assign');
  });
});

describe('objective level (#535)', () => {
  it('github-issue knows the level, the slug regex and the reference', () => {
    const skill = read('skills/github/github-issue/SKILL.md');
    expect(skill).toMatch(/\| `objective` \| `\[Objective\] <outcome>`/);
    expect(skill).toContain('(Objective|Epic|Feature|PBI|Task|Bug)');
    const ref = read('skills/github/github-issue/references/objectives.md');
    expect(ref).toContain('Requires: <owner>/<repo>@<milestone> released|rc');
    expect(ref).toContain('Requires: <owner>/<repo>#<feature>');
    expect(ref).toMatch(/Feature is closed and the release that shipped its last PBI is tagged/);
    expect(ref).toContain('<!-- release-test-rc -->');
    expect(read('skills/github/github-issue/references/milestones.md')).toMatch(
      /\| Objective\s+\| Never/,
    );
    expect(read('site/concepts/issue-model.md')).toContain('[Objective] <outcome>');
  });
});
