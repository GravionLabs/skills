// deliver-lead: a new lead resumes a leaf (#1183). The lead before ends after any action; a new `leafStep` call with
// `resume` continues from the events (same run) or from the `agent:*` label (a run that ended, a run of the loop, or
// a new run), never waits for a worker of the lead before and never merges twice. `leafStep` runs in-process with a
// scripted host (fake-host.mts) over the fake tracker of the loop tests.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  type Action,
  GATES,
  type LeafGates,
  RETRY_LIMIT_S,
  SESSION_BUDGET_S,
  type StepResult,
  leafStep,
} from '../../../skills/delivery/deliver-lead/scripts/leaf.mts';
import { uuid7 } from '../../../skills/delivery/deliver/scripts/events.mts';
import { runGate } from '../../../skills/delivery/deliver/scripts/gates/result.mts';
import { markBody } from '../../../skills/delivery/deliver/scripts/review.mts';
import { type ProfileEvent, profileValidator } from '../../helpers/agent-events-profile.ts';
import { type HostScenario, runLead } from './deliver-lead/fake-host.mts';
import { FAKE_LOGIN, create } from './deliver/tracker/fake.mts';

const root = path.resolve(__dirname, '../../..');
const stepScript = path.join(root, 'skills/delivery/deliver-lead/scripts/step.mts');
const trackerDir = path.resolve(__dirname, 'deliver/tracker');
const profile = profileValidator(
  'deliver@2',
  'skills/delivery/deliver/schema/deliver-profile.schema.json',
);
const PBI = { number: 12, title: '[PBI] feat: leaf step', labels: ['pbi'], body: 'Tier: strong' };
const LATER_MS = 3 * 60 * 60 * 1000;

let dir: string;
let repo: string;
let fakeDir: string;
let eventsDir: string;
const cwd = process.cwd();
const saved = { ...process.env };

const git = (at: string, ...args: string[]) =>
  execFileSync('git', ['-C', at, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const lines = (file: string): Record<string, unknown>[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'deliver-lead-resume-'));
  const origin = path.join(dir, 'origin.git');
  repo = path.join(dir, 'repo');
  fakeDir = path.join(dir, 'fake');
  eventsDir = path.join(dir, 'events');
  mkdirSync(fakeDir);
  execFileSync('git', ['init', '-q', '--bare', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', repo]);
  git(
    repo,
    '-c',
    'user.name=t',
    '-c',
    'user.email=t@t',
    'commit',
    '-q',
    '--allow-empty',
    '-m',
    'a',
  );
  git(repo, 'push', '-q', origin, 'main', 'main:release/next');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'fetch', '-q', 'origin');
  git(repo, 'checkout', '-q', '-b', 'release/next', '--track', 'origin/release/next');
  Object.assign(process.env, {
    FAKE_DIR: fakeDir,
    DELIVER_TRACKER_DIR: trackerDir,
    DELIVER_TICK_MS: '1',
    AGENT_EVENTS_DIR: eventsDir,
  });
  // the guard and merge-approved CLIs judge the checkout of the working directory
  process.chdir(repo);
});

afterAll(() => {
  process.chdir(cwd);
  process.env = saved;
  rmSync(dir, { recursive: true, force: true });
});

/** The run folders of the lead: an earlier run's result file is a risk level the next run reads. */
const runFolders = () => path.join(repo, '.git/deliver');
beforeEach(() => {
  for (const name of readdirSync(fakeDir)) rmSync(path.join(fakeDir, name), { force: true });
  rmSync(runFolders(), { recursive: true, force: true });
});

type Phase = { host?: HostScenario; tracker?: object; labels?: string[]; stopAfter?: number };

/** The scenario of the fake tracker: issue #12 with `labels`. */
function scenario(tracker: object = {}, labels: string[] = []) {
  writeFileSync(
    path.join(fakeDir, 'scenario.json'),
    JSON.stringify({
      items: [],
      repositories: { 'fake/repo': { issues: [{ ...PBI, labels: ['pbi', ...labels] }] } },
      ...tracker,
    }),
  );
}

/**
 * A run of `run`: each phase is one lead with its own host; a lead with `stopAfter` ends after that many actions,
 * the next one starts `LATER_MS` later with `resume`. Every action is asked twice and must not change on the repeat.
 */
async function leads(phases: Phase[], run = uuid7()) {
  const context = { cwd: repo, selection: {}, trustAuthors: false };
  const calls: string[] = [];
  const gates = Object.fromEntries(
    Object.entries(GATES).map(([name, gate]) => [
      name,
      (...args: unknown[]) => {
        calls.push(name);
        return (gate as (...a: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as LeafGates;
  let clock = Date.parse('2026-11-28T12:00:00Z');
  const eventFile = path.join(eventsDir, `${run}.jsonl`);
  const perPhase: Action[][] = [];
  let report;
  for (const [index, phase] of phases.entries()) {
    scenario(phase.tracker, phase.labels);
    // the scripted gates of a shared fake tracker start over with each lead
    rmSync(path.join(fakeDir, 'gate-calls'), { force: true });
    const fake = create({ ...context, base: 'release/next' });
    let first = index > 0;
    const step = (result: StepResult | undefined, resume = false) =>
      leafStep({
        now: () => clock,
        tracker: fake,
        trackerAt: (base) => (base === 'release/next' ? fake : create({ ...context, base })),
        events: eventsDir,
        issue: 12,
        run,
        result,
        resume,
        cwd: repo,
        layers: [],
        gates,
      });
    const actions: Action[] = [];
    perPhase.push(actions);
    try {
      const out = await runLead(
        (result) => {
          const resume = first;
          first = false;
          return step(result, resume);
        },
        {
          fakeDir,
          issue: 12,
          scenario: phase.host ?? {},
          max: phase.stopAfter ?? 40,
          prefix: `lead${index + 1}-`,
          onWait: (timeout) => {
            clock += timeout * 1000;
          },
        },
        async (action, again) => {
          actions.push(action);
          const written = lines(eventFile).length;
          // the call without `resume` after a resume returns the same action and writes nothing
          expect(await again()).toEqual(action);
          expect(lines(eventFile)).toHaveLength(written);
        },
      );
      report = out.report;
      break;
    } catch (error) {
      if (!String(error).includes('no end after')) throw error;
    }
    clock += LATER_MS;
  }
  const events = lines(eventFile) as ProfileEvent[];
  return {
    report,
    perPhase,
    events,
    calls,
    eventFile,
    merges: lines(path.join(fakeDir, 'merges.jsonl')),
    stages: lines(path.join(fakeDir, 'stages.jsonl')).map((line) => line.stage),
  };
}

const startsOf = (actions: Action[]) =>
  actions.filter((a): a is Extract<Action, { do: 'start-worker' }> => a.do === 'start-worker');
const handlesOf = (actions: Action[]) =>
  actions.flatMap((a) =>
    a.do === 'wait-any' ? a.handles : a.do === 'read-result' ? [a.handle] : [],
  );
const ofType = (events: ProfileEvent[], type: string) => events.filter((e) => e.type === type);
const named = (events: ProfileEvent[], type: string, name: string) =>
  events.filter((e) => e.type === type && (e.step as { name?: string })?.name === name);

/** No action of a resumed lead names a handle of a lead before it. */
function expectOwnHandles(perPhase: Action[][]) {
  for (const [index, actions] of perPhase.entries())
    for (const handle of handlesOf(actions)) expect(handle).toMatch(`lead${index + 1}-`);
}

/** The comment of the loop's mark: `markBody` as the loop writes it. */
const mark = (verdict: 'approve' | 'changes', head: string, login = FAKE_LOGIN, risk = 'low') => ({
  login,
  body: markBody(
    verdict === 'approve'
      ? { verdict, findings: [], unmet: [] }
      : {
          verdict,
          findings: [{ severity: 'blocking', file: 'src/a.ts', summary: 'off by one' }],
          unmet: [],
        },
    head,
    risk,
  ),
});

describe('a new lead resumes a run from its events', () => {
  // the pass path: start, wait, read of the implementer, then of the reviewer
  const stages = [
    [1, 'implementing: the start of the implementer'],
    [2, 'implementing: the implementer opened its pull request'],
    [3, 'implementing: its report was read'],
    [4, 'review: the start of the reviewer'],
    [5, 'review: the reviewer wrote its verdict file'],
    [6, 'review: its report was read'],
  ] as const;
  it.each(stages)('lead ends after action %i (%s): merged exactly once', async (stopAfter) => {
    const out = await leads([{ stopAfter }, {}]);
    expect(out.report).toMatchObject({ outcome: 'merged', reason: 'merged' });
    expect(out.merges).toEqual([
      { pull: 112, head: 'abc123', base: 'release/next', title: 'fake #112' },
    ]);
    expectOwnHandles(out.perPhase);
    // a worker the lead before started and recorded is not started again; its result counts
    const resumed = startsOf(out.perPhase[1]!).map((a) => a.role);
    expect(resumed).toEqual(
      stopAfter === 1 ? ['implementer', 'reviewer'] : stopAfter <= 4 ? ['reviewer'] : [],
    );
    expect(ofType(out.events, 'deliver.merged')).toHaveLength(1);
    expect(named(out.events, 'step.started', 'resume')).toMatchObject([
      { task: 'issue-12', deliver: { restart: false } },
    ]);
    profile.expectRun(out.events);
  });

  it('starts the implementer again when the one before left no pull request', async () => {
    const out = await leads([{ stopAfter: 2, host: { implementer: { noPull: true } } }, {}]);
    expect(out.report).toMatchObject({ outcome: 'merged' });
    const [implementer] = startsOf(out.perPhase[1]!);
    expect(implementer).toMatchObject({ role: 'implementer', name: 'issue-12-implement-try-2' });
    expect(named(out.events, 'step.started', 'implement').at(-1)).toMatchObject({
      deliver: { counted: 'timeout', attempt: 2 },
    });
    expectOwnHandles(out.perPhase);
    profile.expectRun(out.events);
  });

  it('starts the reviewer again when the one before left no verdict', async () => {
    const out = await leads([{ stopAfter: 5, host: { reviewer: { verdict: 'none' } } }, {}]);
    expect(out.report).toMatchObject({ outcome: 'merged' });
    expect(startsOf(out.perPhase[1]!)).toMatchObject([
      { role: 'reviewer', name: 'issue-12-review-1-try-2' },
    ]);
    expectOwnHandles(out.perPhase);
  });

  it('a fix round the lead before started: the verdict of the changes round is fixed, then merged', async () => {
    const shared = { shared: true };
    const out = await leads([
      { stopAfter: 7, tracker: shared, host: { reviewer: { verdict: 'changes' } } },
      { tracker: shared },
    ]);
    expect(startsOf(out.perPhase[0]!).at(-1)).toMatchObject({ name: 'issue-12-fix-1' });
    expect(startsOf(out.perPhase[1]!).map((a) => a.name)).toEqual([
      'issue-12-fix-1',
      'issue-12-review-2',
    ]);
    expect(out.report).toMatchObject({ outcome: 'merged' });
    expect(out.merges).toHaveLength(1);
    expectOwnHandles(out.perPhase);
  });

  it('never hands over for the session budget of a worker of the lead before', async () => {
    // the implementer did not finish: the new lead starts 3 h later, past the budget of the old worker
    expect(LATER_MS / 1000).toBeGreaterThan(SESSION_BUDGET_S);
    const out = await leads([{ stopAfter: 2, host: { implementer: { state: 'timeout' } } }, {}]);
    expect(out.report).toMatchObject({ outcome: 'merged' });
    expect(ofType(out.events, 'deliver.aside')).toEqual([]);
    expectOwnHandles(out.perPhase);
  });

  it('measures the retry wait of the merge from the resume, not from before', async () => {
    const pending = { state: 'pending', reported: false };
    const ready = { state: 'ready', reported: true, head: 'abc123' };
    // the lead before waited once after retry, then ended; the checks turn green after the resume
    const out = await leads([
      { stopAfter: 8, tracker: { shared: true, gates: [pending] } },
      // each action is asked twice: the first two reads of the new lead are pending
      { tracker: { shared: true, gates: [pending, pending, ready] } },
    ]);
    expect(LATER_MS / 1000).toBeGreaterThan(RETRY_LIMIT_S);
    expect(out.perPhase[0]!.at(-1)).toMatchObject({ do: 'wait-any', handles: [] });
    expect(out.perPhase[1]![0]).toMatchObject({ do: 'wait-any', handles: [] });
    expect(out.report).toMatchObject({ outcome: 'merged' });
    expect(out.merges).toHaveLength(1);
  });

  it('a run that already merged: ends without a merge gate', async () => {
    const run = uuid7();
    const done = await leads([{}], run);
    expect(done.merges).toHaveLength(1);
    const again = await leads([{ stopAfter: 0 }, {}], run);
    expect(again.report).toMatchObject({ outcome: 'merged' });
    expect(again.calls).toEqual([]);
    expect(again.merges).toHaveLength(1);
    expect(named(again.events, 'step.started', 'resume')).toEqual([]);
  });

  it('a merge without its step.finished is delivered once', async () => {
    const run = uuid7();
    const out = await leads([{}], run);
    const merge = out.events.findIndex(
      (e) => e.type === 'step.started' && (e.step as { name: string }).name === 'merge',
    );
    writeFileSync(
      out.eventFile,
      `${out.events
        .slice(0, merge + 1)
        .map((e) => JSON.stringify(e))
        .join('\n')}\n`,
    );
    const again = await leads(
      [{ stopAfter: 0, tracker: { shared: true } }, { tracker: { shared: true } }],
      run,
    );
    expect(again.report).toMatchObject({ outcome: 'merged' });
    expect(again.merges).toHaveLength(1);
    expect(ofType(again.events, 'deliver.merged')).toHaveLength(1);
  });
});

describe('a new lead resumes an issue from its agent:* label', () => {
  const pr = () => writeFileSync(path.join(fakeDir, 'pr-12'), '');
  /** A run whose first call resumes: the lead before is another run (or the loop). */
  const resumeNew = (phase: Phase, run = uuid7()) =>
    leads([{ stopAfter: 0, ...phase }, phase], run);

  it('agent:approved with the loop mark for the head: merged without a session', async () => {
    pr();
    const out = await resumeNew({
      labels: ['agent:approved'],
      tracker: { pullComments: { 112: [mark('approve', 'abc123')] } },
    });
    expect(out.report).toMatchObject({ outcome: 'merged', reason: 'merged' });
    expect(out.perPhase[1]!.map((a) => a.do)).toEqual(['end']);
    expect(out.merges).toEqual([
      { pull: 112, head: 'abc123', base: 'release/next', title: 'fake #112' },
    ]);
    expect(out.calls).toContain('guard');
    expect(named(out.events, 'step.started', 'review-1')).toMatchObject([
      { deliver: { resumed: 'mark', head: 'abc123' } },
    ]);
    expect(out.stages.at(-1)).toBeNull();
    profile.expectRun(out.events);
  });

  it('agent:approved left by a stopped run of the loop: the same run resumes and merges', async () => {
    pr();
    const run = uuid7();
    // the events the loop wrote for the issue: its steps carry no role
    const loop = [
      { type: 'run.started', profiles: ['deliver@2'], subject: { kind: 'github.issue', id: '12' } },
      { type: 'task.started', task: 'issue-12' },
      { type: 'step.started', task: 'issue-12', step: { name: 'implement', text: 'session' } },
      { type: 'step.finished', task: 'issue-12', step: { name: 'implement', text: 'done' } },
      { type: 'step.started', task: 'issue-12', step: { name: 'review-1', n: 1, text: 'review' } },
      { type: 'step.finished', task: 'issue-12', step: { name: 'review-1', text: 'approve' } },
      { type: 'task.finished', task: 'issue-12', outcome: 'cancelled', text: 'stopped' },
    ];
    mkdirSync(eventsDir, { recursive: true });
    writeFileSync(
      path.join(eventsDir, `${run}.jsonl`),
      loop
        .map((e, i) =>
          JSON.stringify({
            v: 1,
            seq: i + 1,
            ts: '2026-11-28T10:00:00Z',
            run,
            tone: 'neutral',
            ...e,
          }),
        )
        .join('\n')
        .concat('\n'),
    );
    const out = await resumeNew(
      {
        labels: ['agent:approved'],
        tracker: { pullComments: { 112: [mark('approve', 'abc123')] } },
      },
      run,
    );
    expect(out.report).toMatchObject({ outcome: 'merged' });
    expect(out.merges).toHaveLength(1);
    expect(named(out.events, 'step.started', 'resume')).toMatchObject([
      { deliver: { restart: true } },
    ]);
    // the task runs again: a task.started after the loop's task.finished
    expect(ofType(out.events, 'task.started')).toHaveLength(2);
  });

  it.each([
    ['another login', [mark('approve', 'abc123', 'someone')]],
    ['an edited comment', [{ ...mark('approve', 'abc123'), edited: true }]],
    ['another head', [mark('approve', 'feed00')]],
    ['changes after the approval', [mark('approve', 'abc123'), mark('changes', 'abc123')]],
  ])('agent:approved with a mark of %s: no merge without a review', async (_, comments) => {
    pr();
    const out = await resumeNew({
      labels: ['agent:approved'],
      tracker: { pullComments: { 112: comments } },
    });
    if (_ === 'changes after the approval') {
      // the newest mark for the head counts: its findings are fixed first
      expect(startsOf(out.perPhase[1]!).map((a) => a.role)).toEqual(['implementer', 'reviewer']);
      expect(out.merges).toHaveLength(1);
      return;
    }
    expect(startsOf(out.perPhase[1]!).map((a) => a.role)).toEqual(['reviewer']);
    if (_ === 'another head') {
      // the risk level of a mark of the loop counts for the pull request, as in the loop
      expect(out.report).toMatchObject({ outcome: 'merged' });
      expect(out.merges).toHaveLength(1);
      return;
    }
    // a mark nobody can trust gives no risk level either: the merge gate hands the pull request over
    expect(out.report).toMatchObject({ outcome: 'ended', gate: 'merge-approved', result: 'owner' });
    expect(out.report!.reason).toMatch(/no risk level/);
    expect(out.merges).toEqual([]);
  });

  it('agent:changes with the loop mark: the implementer fixes the recorded findings', async () => {
    pr();
    const out = await resumeNew({
      labels: ['agent:changes'],
      tracker: { pullComments: { 112: [mark('changes', 'abc123')] } },
    });
    const [fix, review] = startsOf(out.perPhase[1]!);
    expect(fix).toMatchObject({ role: 'implementer', name: 'issue-12-fix-1' });
    const file = /--review-file ([^\s`]+)/.exec(fix!.brief)![1]!;
    expect(JSON.parse(readFileSync(file, 'utf8'))).toMatchObject({
      verdict: 'changes',
      findings: [{ file: 'src/a.ts', summary: 'off by one' }],
      head: 'abc123',
    });
    expect(review).toMatchObject({ role: 'reviewer' });
    expect(out.report).toMatchObject({ outcome: 'merged' });
  });

  it('agent:review or agent:implementing with an open pull request: the reviewer', async () => {
    for (const label of ['agent:review', 'agent:implementing']) {
      pr();
      // the result file of an earlier run keeps the risk level
      const earlier = path.join(runFolders(), 'earlier-run');
      mkdirSync(earlier, { recursive: true });
      writeFileSync(
        path.join(earlier, '12.result.json'),
        JSON.stringify({ risk: { level: 'low' } }),
      );
      const out = await resumeNew({ labels: [label] });
      expect(startsOf(out.perPhase[1]!).map((a) => a.role)).toEqual(['reviewer']);
      expect(out.report).toMatchObject({ outcome: 'merged' });
      rmSync(path.join(fakeDir, 'merges.jsonl'));
    }
  });

  it('agent:implementing without a pull request: the implementer again, counted as a timeout', async () => {
    const out = await resumeNew({ labels: ['agent:implementing'] });
    expect(startsOf(out.perPhase[1]!).map((a) => a.role)).toEqual(['implementer', 'reviewer']);
    expect(named(out.events, 'step.started', 'implement')[0]).toMatchObject({
      deliver: { counted: 'timeout', resumed: 'implementing' },
    });
    expect(out.report).toMatchObject({ outcome: 'merged' });
  });

  it('agent:handover stays with the person', async () => {
    pr();
    const out = await resumeNew({ labels: ['agent:handover'] });
    expect(out.perPhase[1]).toMatchObject([{ do: 'end' }]);
    expect(out.report).toMatchObject({ outcome: 'ended', gate: 'stage' });
    expect(out.merges).toEqual([]);
  });

  it('a merged pull request ends as merged, without a merge', async () => {
    const out = await resumeNew({ labels: ['agent:approved'], tracker: { mergedBefore: [12] } });
    expect(out.report).toMatchObject({ outcome: 'merged', reason: 'already merged' });
    expect(out.calls).not.toContain('mergeApproved');
    expect(out.merges).toEqual([]);
    expect(out.stages).toEqual([null]);
  });

  it('a task a gate word ended in agent:approved: the same run resumes and merges once', async () => {
    const run = uuid7();
    const first = await leads([{ tracker: { mergeRefused: 'base branch was modified' } }], run);
    expect(first.report).toMatchObject({ outcome: 'ended', gate: 'merge-approved' });
    expect(first.merges).toEqual([]);
    // the label the gate left; the verdict of the run is bound to the head
    const out = await leads(
      [{ stopAfter: 0, labels: ['agent:approved'] }, { labels: ['agent:approved'] }],
      run,
    );
    expect(out.report).toMatchObject({ outcome: 'merged' });
    expect(startsOf(out.perPhase[1]!)).toEqual([]);
    expect(named(out.events, 'step.started', 'review-2')).toMatchObject([
      { deliver: { resumed: 'run' } },
    ]);
    expect(out.merges).toHaveLength(1);
    profile.expectRun(out.events);
  });
});

describe('step.mts --resume', () => {
  it('passes --resume and refuses it with --result', async () => {
    scenario();
    mkdirSync(path.join(repo, '.agents'), { recursive: true });
    writeFileSync(
      path.join(repo, '.agents/config.json'),
      JSON.stringify({ deliver: { tracker: 'fake' } }),
    );
    const env = { ...process.env };
    const run = uuid7();
    const out = execFileSync(
      process.execPath,
      [stepScript, 'leaf', '12', '--run', run, '--resume'],
      {
        cwd: repo,
        env,
        encoding: 'utf8',
      },
    );
    expect(JSON.parse(out)).toMatchObject({ do: 'start-worker', role: 'implementer' });
    const result = path.join(dir, 'result.json');
    writeFileSync(result, '{}');
    await expect(
      runGate(stepScript, ['leaf', '12', '--run', run, '--resume', '--result', result], {
        cwd: repo,
        env,
      }),
    ).resolves.toMatchObject({ result: 'usage' });
    rmSync(path.join(repo, '.agents'), { recursive: true, force: true });
  });
});
