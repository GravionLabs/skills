import * as fs from 'fs';
import * as path from 'path';

const read = (p: string) => fs.readFileSync(path.resolve(__dirname, '../../..', p), 'utf-8');
const prDir = 'skills/github-pull-request';
const prSkill = read(`${prDir}/SKILL.md`);
const prAll = `${prSkill}\n${read(`${prDir}/references/release-mode.md`)}`;
const releaseSkill = read('skills/github-release/SKILL.md');
const step8 = releaseSkill.slice(
  releaseSkill.indexOf('\n3. `releasePr` set'),
  releaseSkill.indexOf('\n4. Report'),
);

// the head pattern as written in the skill, executed against sample branches
const headPattern = /`(\^release\/\(next\|\[0-9\]\+\\\.\[0-9\]\+\)\$)`/.exec(prSkill)?.[1];

// #668: github-release finish needs a PR path for release heads without an issue number
describe('github-pull-request release mode', () => {
  it('the documented head pattern matches release heads only', () => {
    expect(headPattern).toBeDefined();
    const re = new RegExp(headPattern as string);
    expect(re.test('release/next')).toBe(true);
    expect(re.test('release/2.5')).toBe(true);
    expect(re.test('feature/x')).toBe(false);
    expect(re.test('release/foo')).toBe(false);
    expect(re.test('release/2.5.1')).toBe(false);
  });

  it('requires the default branch as base and no issue_number', () => {
    expect(prSkill).toMatch(
      /`<base>` is the default branch \(`gh repo view --json defaultBranchRef/,
    );
    expect(prSkill).toMatch(/Release mode needs no `issue_number`/);
    expect(prSkill).toMatch(/stop when neither exists, except in release mode/);
  });

  it('closes only the Feature, only when passed, and reports none otherwise', () => {
    expect(prAll).toMatch(
      /`Closes #<feature_number>` only when `feature_number` is passed, else none/,
    );
    expect(prAll).toMatch(/Never `Closes #<issue_number>`/);
    expect(prAll).toMatch(/`none` in release mode without `feature_number`/);
  });

  it('still stops for any other head without a number', () => {
    expect(prSkill).toMatch(/Every other head without a number still stops/);
    expect(prSkill).toMatch(/the head is not `release\/\*`[^\n]*stop and report/);
  });

  it('keeps auto_merge false, non-empty PR, pushed branch and CHANGELOG.md untouched', () => {
    expect(prSkill).toMatch(/In release mode `auto_merge` is forced false/);
    expect(prSkill).toMatch(/Never create an empty PR[^\n]*also in release mode/);
    expect(prSkill).toMatch(/Branch must be pushed/);
    expect(prSkill).toMatch(/Release mode never modifies `CHANGELOG\.md`/);
  });

  it('bounds the merged_prs default to unreleased PRs', () => {
    expect(prSkill).toMatch(/--limit 200[^\n]*merged:>=/);
  });

  it('github-release finish step 3 passes release-mode inputs and forbids gh pr create', () => {
    expect(step8).toMatch(/`title: release: <branch>`/);
    expect(step8).toMatch(/`merged_prs`/);
    expect(step8).toMatch(/`feature_number` only when recorded/);
    expect(step8).toMatch(/`auto_merge: false`/);
    expect(step8).toMatch(/Never use a direct `gh pr create`/);
  });

  it('review_notes replaces the review-fanout inputs and the standalone step names no title format', () => {
    expect(prSkill).toMatch(/`review_notes` \(default: empty\)/);
    expect(prSkill).toMatch(/add `## Review notes`[^\n]*before the footer/);
    expect(prSkill).toMatch(/never turn `Closes` into `Refs`/);
    expect(prSkill).not.toMatch(/advisories_not_fixed|follow_up_candidates/);
    const standalone = read('skills/github-issue/references/standalone-issue.md');
    const step12 = /\n12\. [^\n]*/.exec(standalone)?.[0] ?? '';
    expect(step12).toMatch(/`base_branch: <base>`/);
    expect(step12).not.toMatch(/<type>|Closes/);
  });
});
