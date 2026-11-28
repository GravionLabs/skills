// deliver-lead: the tree flow starts a leaf lead per leaf of a Feature, Epic or milestone (#1185). `treeStep` runs
// in-process over the fake tracker of the loop tests, read anew on every call; a scripted host stands for the leaf
// leads, which close their issue on the tracker (or not).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RETRY_LIMIT_S,
  SESSION_BUDGET_S,
  type StepResult,
} from '../../../skills/delivery/deliver-lead/scripts/leaf.mts';
import {
  LEAD_BUDGET_S,
  type TreeAction,
  type TreeInput,
  type TreeReport,
  treeStep,
} from '../../../skills/delivery/deliver-lead/scripts/tree.mts';
import { uuid7 } from '../../../skills/delivery/deliver/scripts/events.mts';
import { releaseGate } from '../../../skills/delivery/deliver/scripts/gates/release-gate.mts';
import { runGate } from '../../../skills/delivery/deliver/scripts/gates/result.mts';
import { type ProfileEvent, profileValidator } from '../../helpers/agent-events-profile.ts';
import { type FakeIssue, type Scenario, create } from './deliver/tracker/fake.mts';

const root = path.resolve(__dirname, '../../..');
const stepScript = path.join(root, 'skills/delivery/deliver-lead/scripts/step.mts');
const trackers = path.resolve(__dirname, 'deliver/tracker');
const profile = profileValidator(
  'deliver@2',
  'skills/delivery/deliver/schema/deliver-profile.schema.json',
);

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

// Epic #2 -> Feature #4 (three PBIs and a Bug, delivered 13, 15, 14, 12), Feature #5 (#21); Feature #6 (#31 held,
// #32 blocked by it, #33); M001 holds Features #4 and #5
const ISSUES: FakeIssue[] = [
  parent('Objective', 1, [2]),
  parent('Epic', 2, [4, 5]),
  parent('Feature', 4, [12, 13, 14, 15], { milestone: 'M001' }),
  parent('Feature', 5, [21], { milestone: 'M001' }),
  parent('Feature', 6, [31, 32, 33]),
  work(12, { blockedBy: [14] }),
  work(13, { body: 'Tier: strong — hard' }),
  work(14, { blockedBy: [15] }),
  work(15, { title: '[Bug] item 15', labels: ['bug'], blockedBy: [13] }),
  work(21, { blockedBy: [12] }),
  work(31, { labels: ['pbi', 'needs-decision'] }),
  work(32, { blockedBy: [31] }),
  work(33),
];

let dir: string;
let events: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'deliver-lead-tree-'));
  events = path.join(dir, 'events');
  scenario({});
  vi.stubEnv('FAKE_DIR', dir);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

function scenario(extra: Partial<Scenario>, issues: FakeIssue[] = ISSUES) {
  const value: Scenario = {
    items: [],
    repositories: {
      'fake/repo': { issues, milestones: [{ title: 'M001', closed: false }] },
    },
    ...extra,
  };
  writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(value));
}
const read = (): Scenario => JSON.parse(readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
/** What a leaf lead (or a person) does to the tracker. */
function change(number: number, extra: Partial<FakeIssue>) {
  const value = read();
  const issue = value.repositories!['fake/repo']!.issues!.find((i) => i.number === number)!;
  Object.assign(issue, extra);
  writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(value));
}
const close = (number: number) => change(number, { state: 'closed' });
const mergeOnly = (number: number) => {
  writeFileSync(
    path.join(dir, 'scenario.json'),
    JSON.stringify({ ...read(), mergedBefore: [...(read().mergedBefore ?? []), number] }),
  );
};

type Start = Extract<TreeAction, { do: 'start-worker' }>;
type Wait = Extract<TreeAction, { do: 'wait-any' }>;

/** A tree lead of one run: its own clock and the step with a fresh tracker per call. */
function treeLead(ref: string, options: Partial<TreeInput> = {}) {
  const run = options.run ?? uuid7();
  const clock = { now: Date.parse('2026-11-28T12:00:00Z') };
  const gateCalls: string[] = [];
  const step = (result?: StepResult, resume = false) =>
    treeStep({
      tracker: create({
        cwd: dir,
        base: 'release/next',
        selection: ref.startsWith('M') ? { milestone: ref } : {},
        trustAuthors: false,
      }),
      events,
      ref,
      run,
      result,
      resume,
      cwd: dir,
      layers: [],
      now: () => clock.now,
      gates: {
        releaseGate: (input) => {
          gateCalls.push(input.milestone);
          return releaseGate(input);
        },
      },
      ...options,
    });
  const file = path.join(events, `${run}.jsonl`);
  const written = (): ProfileEvent[] =>
    existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  return { run, clock, step, written, gateCalls };
}

/** How a leaf lead ends: its leaf closed, merged but still open, or untouched. */
type Outcome = 'closed' | 'merged' | 'untouched';

/**
 * Runs the tree lead to its end: every start gets a handle, every wait finishes the oldest worker, which does what
 * `outcomes` says for its leaf. Each action is asked twice and must not change nor write.
 */
async function drive(
  lead: ReturnType<typeof treeLead>,
  outcomes: Record<number, Outcome> = {},
  { max = 60, first }: { max?: number; first?: StepResult } = {},
) {
  const actions: TreeAction[] = [];
  const open = new Map<string, number>();
  let peak = 0;
  let result = first;
  for (let i = 0; i < max; i++) {
    const answered = result;
    const action = await lead.step(answered);
    actions.push(action);
    const count = lead.written().length;
    expect(await lead.step(answered)).toEqual(action);
    expect(lead.written()).toHaveLength(count);
    if (action.do === 'end') return { actions, report: action.report, peak };
    if (action.do === 'start-worker') {
      const handle = `w-${action.name}`;
      open.set(handle, Number(/\/deliver-lead (\d+)/.exec(action.brief)![1]));
      peak = Math.max(peak, open.size);
      result = { handle, name: action.name };
    } else if (action.do === 'wait-any') {
      if (action.handles.length === 0) {
        lead.clock.now += action.timeout * 1000;
        result = { state: 'timeout' };
      } else result = { handle: action.handles[0]!, state: 'done' };
    } else {
      const issue = open.get(action.handle)!;
      const outcome = outcomes[issue] ?? 'closed';
      if (outcome === 'closed') close(issue);
      if (outcome === 'merged') mergeOnly(issue);
      open.delete(action.handle);
      result = { handle: action.handle, report: `outcome: merged, #${issue} is done` };
    }
  }
  throw new Error(`no end after ${max} actions`);
}

const starts = (actions: TreeAction[]) =>
  actions.filter((a): a is Start => a.do === 'start-worker');
const leaves = (actions: TreeAction[]) => starts(actions).map((a) => a.name);
const held = (report: TreeReport) => report.waiting.map((l) => [l.number, l.reason]);

describe('treeStep', () => {
  it('delivers three PBIs and a Bug of a Feature in blocked-by order, one at a time', async () => {
    const lead = treeLead('4');
    const out = await drive(lead);
    expect(leaves(out.actions)).toEqual([
      'issue-13-lead',
      'issue-15-lead',
      'issue-14-lead',
      'issue-12-lead',
    ]);
    expect(out.actions.slice(0, 4).map((a) => a.do)).toEqual([
      'start-worker',
      'wait-any',
      'read-result',
      'start-worker',
    ]);
    const [strong, standard] = starts(out.actions);
    expect(strong).toMatchObject({ role: 'lead', base: 'release/next', model: 'opus' });
    expect(standard!.model).toBe('sonnet');
    // a host without slash commands finds the skill by its name
    expect(strong!.brief).toContain('skill `deliver-lead`');
    expect(strong!.brief).toContain('`/deliver-lead 13`');
    expect(strong!.branch).not.toMatch(/^[a-z]+\/13-/);
    expect(out.peak).toBe(1);
    expect(out.report).toEqual({
      ref: '4',
      outcome: 'done',
      reason: 'no open PBI or Bug below 4',
      delivered: [13, 15, 14, 12],
      waiting: [],
    });
    expect(lead.gateCalls).toEqual([]);
    profile.expectRun(lead.written());
    expect(lead.written().filter((e) => e.type === 'deliver.worker')).toHaveLength(4);
  });

  it('ends with a blocked leaf and what it blocks under waiting', async () => {
    const out = await drive(treeLead('6'));
    expect(leaves(out.actions)).toEqual(['issue-33-lead']);
    expect(out.report).toMatchObject({ outcome: 'held', delivered: [33] });
    expect(held(out.report)).toEqual([
      [31, 'needs-decision'],
      [32, 'blocked by fake/repo#31'],
    ]);
  });

  it('walks an Epic flat: leaf leads only, no lead of a Feature', async () => {
    const out = await drive(treeLead('2'));
    expect(leaves(out.actions)).toEqual([13, 15, 14, 12, 21].map((nr) => `issue-${nr}-lead`));
    expect(out.report).toMatchObject({ outcome: 'done', waiting: [] });
  });

  it('runs release-gate once when the tree of a milestone is done', async () => {
    const lead = treeLead('M001');
    const out = await drive(lead);
    expect(leaves(out.actions)).toHaveLength(5);
    expect(lead.gateCalls).toEqual(['M001']);
    expect(out.report.release).toEqual({
      result: 'pass',
      reason: 'M001 is ready for its release pull request',
      retroCommand: '/retro --milestone M001 --post',
    });
    // a repeated call and a new lead of the run take the recorded result
    expect(await lead.step()).toEqual({ do: 'end', report: out.report });
    const resumed = await lead.step(undefined, true);
    expect(resumed).toMatchObject({ do: 'end', report: { release: out.report.release } });
    expect(lead.gateCalls).toEqual(['M001']);
    profile.expectRun(lead.written());
  });

  it('runs no release-gate while a leaf of the milestone is held', async () => {
    change(21, { labels: ['pbi', 'interactive'] });
    const lead = treeLead('M001');
    const out = await drive(lead);
    expect(held(out.report)).toEqual([[21, 'interactive']]);
    expect(out.report.release).toBeUndefined();
    expect(lead.gateCalls).toEqual([]);
  });

  it('resumes mid-tree with the next open leaf and never waits for the old leaf lead', async () => {
    const before = treeLead('4');
    const first = (await before.step()) as Start;
    await before.step({ handle: 'old-13', name: first.name });
    close(13);
    await before.step({ handle: 'old-13', report: 'done' });
    const second = (await before.step({ handle: 'old-13', report: 'done' })) as Start;
    expect(second.name).toBe('issue-15-lead');
    await before.step({ handle: 'old-15', name: second.name });

    const after = treeLead('4', { run: before.run });
    const restarted = (await after.step(undefined, true)) as Start;
    expect(restarted).toMatchObject({ do: 'start-worker', name: 'issue-15-lead-try-2' });
    expect(restarted.branch).not.toBe(second.branch);
    // an answer of the old worker is no handle of the new one
    expect(await after.step({ handle: 'old-15', state: 'done' })).toEqual(restarted);
    const out = await drive(after);
    expect(out.report).toMatchObject({ outcome: 'done', delivered: [13, 15, 14, 12] });
    profile.expectRun(after.written());
  });

  it('runs at most deliver.parallel leaf leads at once', async () => {
    const lead = treeLead('4', { config: { deliver: { parallel: 2 } } });
    change(14, { blockedBy: [] });
    const first = (await lead.step()) as Start;
    const second = (await lead.step({ handle: 'a', name: first.name })) as Start;
    expect([first.name, second.name]).toEqual(['issue-13-lead', 'issue-14-lead']);
    expect(await lead.step({ handle: 'b', name: second.name })).toMatchObject({
      do: 'wait-any',
      handles: ['a', 'b'],
    });
    close(14);
    // the place of #14 goes to #12, which it blocked, while #13 still runs
    const third = (await lead.step({ handle: 'b', report: '' })) as Start;
    expect(third.name).toBe('issue-12-lead');
    expect(await lead.step({ handle: 'c', name: third.name })).toMatchObject({
      do: 'wait-any',
      handles: ['a', 'c'],
    });
    close(12);
    // the place is free, but nothing else is ready before #13
    expect(await lead.step({ handle: 'c', report: '' })).toMatchObject({
      do: 'wait-any',
      handles: ['a'],
    });
  });

  it('does not trust a leaf lead and never starts it a second time', async () => {
    const out = await drive(treeLead('6'), { 33: 'untouched' });
    expect(leaves(out.actions)).toEqual(['issue-33-lead']);
    expect(out.report.delivered).toEqual([]);
    expect(held(out.report)).toContainEqual([
      33,
      'its leaf lead ended and the issue is not delivered',
    ]);
  });

  it('holds a leaf in agent:handover and does not start a lead for it', async () => {
    change(33, { labels: ['pbi', 'agent:handover'] });
    const out = await drive(treeLead('6'));
    expect(starts(out.actions)).toEqual([]);
    expect(held(out.report)).toContainEqual([33, 'handed over (agent:handover): a person decides']);
  });

  it.each(['error', 'gone'] as const)('goes on after a leaf lead ended with %s', async (state) => {
    const lead = treeLead('4');
    const first = (await lead.step()) as Start;
    await lead.step({ handle: 'a', name: first.name });
    const end = await lead.step({ handle: 'a', state });
    // #15 waits for #13, nothing else is ready
    expect(end).toMatchObject({ do: 'end', report: { outcome: 'held', delivered: [] } });
    expect((end as { report: TreeReport }).report.waiting.map((l) => l.number)).toContain(13);
  });

  it('keeps the place of a leaf lead that asks the owner', async () => {
    change(14, { blockedBy: [] });
    const lead = treeLead('4');
    const first = (await lead.step()) as Start;
    await lead.step({ handle: 'a', name: first.name });
    expect(await lead.step({ handle: 'a', state: 'blocked', question: 'a token?' })).toEqual({
      do: 'read-result',
      handle: 'a',
      question: 'a token?',
    });
    expect(await lead.step({ handle: 'a', answer: 'sent' })).toMatchObject({ do: 'wait-any' });
    const end = (await lead.step({ handle: 'a', answer: 'owner', question: 'a token?' })) as {
      report: TreeReport;
    };
    expect(held(end.report)).toContainEqual([
      13,
      'its leaf lead asks what only the owner answers: "a token?"',
    ]);
    expect(held(end.report)).toContainEqual([
      14,
      'not started: a leaf lead that may still work holds its place',
    ]);
    // once #13 is delivered its place is free
    close(13);
    expect(await lead.step(undefined, true)).toMatchObject({ name: 'issue-14-lead' });
  });

  it('stops waiting for a leaf lead past its budget', async () => {
    const lead = treeLead('4');
    const first = (await lead.step()) as Start;
    await lead.step({ handle: 'a', name: first.name });
    lead.clock.now += 1000;
    const wait = (await lead.step({ state: 'timeout' })) as Wait;
    expect(wait.handles).toEqual(['a']);
    lead.clock.now += LEAD_BUDGET_S * 1000;
    expect(await lead.step({ state: 'timeout' })).toMatchObject({
      do: 'end',
      report: { outcome: 'held' },
    });
  });

  it('waits for the tracker to close a merged leaf before what it blocks starts', async () => {
    const lead = treeLead('4');
    const first = (await lead.step()) as Start;
    await lead.step({ handle: 'a', name: first.name });
    mergeOnly(13);
    const wait = (await lead.step({ handle: 'a', report: '' })) as Wait;
    expect(wait).toMatchObject({ do: 'wait-any', handles: [], why: 'merged, still open: #13' });
    close(13);
    lead.clock.now += wait.timeout * 1000;
    expect(await lead.step({ state: 'timeout' })).toMatchObject({ name: 'issue-15-lead' });
  });

  it('ends when a merged leaf stays open, and never starts a merged leaf', async () => {
    mergeOnly(13);
    const lead = treeLead('4');
    const out = await drive(lead);
    expect(starts(out.actions)).toEqual([]);
    expect(held(out.report)).toContainEqual([13, 'merged, the issue is still open']);
    const waited = out.actions.reduce((sum, a) => sum + (a.do === 'wait-any' ? a.timeout : 0), 0);
    expect(waited).toBeGreaterThanOrEqual(RETRY_LIMIT_S);
  });

  it('goes on after a refused start, once, and ends a start that is never answered', async () => {
    change(14, { blockedBy: [] });
    const lead = treeLead('4');
    const first = (await lead.step()) as Start;
    const refused = { name: first.name, error: 'declined' };
    const second = (await lead.step(refused)) as Start;
    expect(second.name).toBe('issue-14-lead');
    expect(await lead.step(refused)).toEqual(second);
    lead.clock.now += SESSION_BUDGET_S * 1000;
    const end = (await lead.step()) as { report: TreeReport };
    expect(held(end.report)).toContainEqual([13, 'the leaf lead did not start: declined']);
    expect(held(end.report)).toContainEqual([
      14,
      `the leaf lead did not start: no handle within ${SESSION_BUDGET_S / 60} min`,
    ]);
  });

  it.each([
    ['an Objective', '1', {}],
    ['a PBI', '12', {}],
    ['an unknown milestone', 'M009', {}],
    ['no reference', 'next', {}],
    ['deliver.parallel 0', '4', { config: { deliver: { parallel: 0 } } }],
  ])('refuses %s', async (_, ref, options) => {
    const lead = treeLead(ref, options);
    await expect(lead.step()).rejects.toThrow();
    expect(lead.written()).toEqual([]);
  });

  it('refuses the run of another tree', async () => {
    const lead = treeLead('4');
    await lead.step();
    await expect(treeLead('6', { run: lead.run }).step()).rejects.toThrow(/leads 4, not 6/);
  });
});

describe('step.mts tree', () => {
  it('prints the action of a Feature and a milestone, and usage for a PBI', async () => {
    const repo = path.join(dir, 'repo');
    execFileSync('git', ['init', '-q', repo]);
    const env = {
      ...process.env,
      FAKE_DIR: dir,
      DELIVER_TRACKER_DIR: trackers,
      AGENT_EVENTS_DIR: events,
    };
    mkdirSync(path.join(repo, '.agents'));
    writeFileSync(
      path.join(repo, '.agents/config.json'),
      JSON.stringify({ deliver: { tracker: 'fake' } }),
    );
    for (const ref of ['4', 'M001']) {
      const out = execFileSync(process.execPath, [stepScript, 'tree', ref, '--run', uuid7()], {
        cwd: repo,
        env,
        encoding: 'utf8',
      });
      expect(JSON.parse(out)).toMatchObject({ do: 'start-worker', name: 'issue-13-lead' });
    }
    await expect(
      runGate(stepScript, ['tree', '12', '--run', uuid7()], { cwd: repo, env }),
    ).resolves.toMatchObject({ result: 'usage' });
  });
});
