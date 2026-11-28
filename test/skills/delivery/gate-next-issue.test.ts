// The gate `next-issue`: the next ready PBI or Bug below a Feature, Epic, Objective or milestone.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextIssue } from '../../../skills/delivery/deliver/scripts/gates/next-issue.mts';
import { runGate } from '../../../skills/delivery/deliver/scripts/gates/result.mts';
import { create as github } from '../../../skills/delivery/deliver/scripts/tracker/github.mts';
import { createFakeGh } from '../../helpers/fake-gh';
import { type FakeIssue, type Scenario, create } from './deliver/tracker/fake.mts';

const script = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/gates/next-issue.mts',
);
const trackers = path.resolve(__dirname, 'deliver/tracker');

const work = (number: number, extra: Partial<FakeIssue> = {}): FakeIssue => ({
  number,
  title: `[PBI] item ${number}`,
  labels: ['pbi'],
  ...extra,
});
const parent = (
  kind: 'Objective' | 'Epic' | 'Feature',
  number: number,
  subIssues: number[],
  extra: Partial<FakeIssue> = {},
): FakeIssue => ({
  number,
  title: `[${kind}] ${number}`,
  labels: [kind.toLowerCase()],
  subIssues,
  ...extra,
});

// Objective #1 -> Epic #2 -> Epic #3 -> Feature #4 (#12, #13); Epic #2 -> Feature #5 (#11, held)
const ISSUES: FakeIssue[] = [
  parent('Objective', 1, [2]),
  parent('Epic', 2, [3, 5]),
  parent('Epic', 3, [4]),
  parent('Feature', 4, [12, 13], { milestone: 'M001' }),
  parent('Feature', 5, [11], { milestone: 'M001' }),
  parent('Feature', 6, [14, 15]),
  work(11, { labels: ['pbi', 'needs-decision'] }),
  work(12, { blockedBy: [11] }),
  work(13, { body: 'Tier: strong — hard' }),
  work(14, { state: 'closed' }),
  work(15, { labels: ['bug', 'interactive'] }),
];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'gate-next-issue-'));
  const scenario: Scenario = {
    items: [],
    repositories: {
      'fake/repo': { issues: ISSUES, milestones: [{ title: 'M001', closed: false }] },
    },
  };
  writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(scenario));
  vi.stubEnv('FAKE_DIR', dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

const fake = () => create({ cwd: dir, base: 'release/next', selection: {}, trustAuthors: false });
const next = (ref: string) => nextIssue({ tracker: fake(), ref });
const issue = (number: number, tier: string) => ({
  repo: 'fake/repo',
  number,
  title: `[PBI] item ${number}`,
  tier,
});

describe('nextIssue', () => {
  it.each([
    ['a Feature', '4', issue(13, 'strong')],
    ['an Epic, two levels down', '2', issue(13, 'strong')],
    ['an Objective', '1', issue(13, 'strong')],
    ['a milestone, by its Features', 'M001', issue(13, 'strong')],
  ])('passes with the first ready leaf of %s', (_, ref, expected) => {
    expect(next(ref)).toMatchObject({ result: 'pass', evidence: { issue: expected } });
  });

  it('passes with every held leaf and its reason when none is ready', () => {
    expect(next('6')).toMatchObject({
      result: 'pass',
      evidence: {
        issue: null,
        waiting: [{ repo: 'fake/repo', number: 15, reason: 'interactive' }],
      },
    });
  });

  it.each(['13', '99', 'M999'])('refuses %s, which names no tree', (ref) => {
    expect(() => next(ref)).toThrow(`${ref} is no Feature, Epic, Objective or milestone`);
  });
});

describe('next-issue CLI', () => {
  const run = (args: string[]) =>
    runGate(script, args, {
      cwd: dir,
      env: { ...process.env, DELIVER_TRACKER_DIR: trackers },
    });

  it('prints the result of the tracker it loads', async () => {
    await expect(run(['4', '--tracker', 'fake'])).resolves.toMatchObject({
      result: 'pass',
      evidence: { issue: { number: 13 } },
    });
  });

  it.each([
    ['no reference', []],
    ['a work item', ['13', '--tracker', 'fake']],
    ['an unknown option', ['4', '--nope']],
  ])('reports usage for %s', async (_, args) => {
    await expect(run(args)).resolves.toMatchObject({ result: 'usage' });
  });
});

// Objective o/r#1 -> Epic #2 -> Features o/r#3 (requires an unreleased milestone) and o/up#4 (#8 by a stranger, #9)
const HANDLER = `(call) => {
  const issue = (repo, number, label, extra = {}) => ({
    number,
    title: '[' + label + '] x',
    state: 'open',
    html_url: 'https://example.test/' + repo + '/' + number,
    body: '',
    author_association: 'OWNER',
    labels: [{ name: label }],
    repository_url: 'https://api.github.com/repos/' + repo,
    ...extra,
  });
  const route = call.args[1];
  if (route === 'repos/o/r/issues/1') return { rest: issue('o/r', 1, 'objective') };
  if (route.includes('o/r/issues/1/sub_issues')) return { rest: [[issue('o/r', 2, 'epic')]] };
  if (route.includes('o/r/issues/2/sub_issues'))
    return { rest: [[
      issue('o/r', 3, 'feature', { body: 'Requires: o/up@M001 released' }),
      issue('o/up', 4, 'feature'),
    ]] };
  if (route.includes('o/r/issues/3/sub_issues')) return { rest: [[issue('o/r', 5, 'pbi')]] };
  if (route.includes('o/up/issues/4/sub_issues'))
    return { rest: [[
      issue('o/up', 9, 'pbi'),
      issue('o/up', 8, 'pbi', { author_association: 'NONE' }),
    ]] };
  if (route.includes('o/up/milestones')) return { rest: [[{ title: 'M001', state: 'open' }]] };
  if (route.includes('dependencies/blocked_by')) return { rest: [[]] };
  throw new Error('unexpected ' + call.args.join(' '));
}`;

describe('GitHub tracker: leaves of a tree (fake gh)', () => {
  it('walks the repositories in start order and keeps the rules of the loop', () => {
    const gh = createFakeGh(dir, HANDLER);
    for (const [k, v] of Object.entries(gh.env())) if (v !== undefined) vi.stubEnv(k, v);
    const tracker = github({
      cwd: dir,
      repo: 'o/r',
      base: 'release/next',
      selection: {},
      trustAuthors: false,
    });
    expect(tracker.leaves('1')?.map((leaf) => [leaf.repo, leaf.id, leaf.held])).toEqual([
      ['o/up', 8, undefined],
      ['o/up', 9, undefined],
      ['o/r', 5, 'upstream o/up@M001 not released'],
    ]);
    // #8 is held for its author, so #9 of the other repository is next
    expect(nextIssue({ tracker, ref: '1' }).evidence.issue).toMatchObject({
      repo: 'o/up',
      number: 9,
    });
  });
});
