// deliver-lead: the leaf step script (#1181) delivers a PBI or Bug on the pass path. `leafStep` runs in-process with a
// scripted host (fake-host.mts) over the fake tracker of the loop tests; the gates run in-process as their CLIs do.
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
  type StepResult,
  leafStep,
} from '../../../skills/delivery/deliver-lead/scripts/leaf.mts';
import { uuid7 } from '../../../skills/delivery/deliver/scripts/events.mts';
import { runGate } from '../../../skills/delivery/deliver/scripts/gates/result.mts';
import { type ProfileEvent, profileValidator } from '../../helpers/agent-events-profile.ts';
import { type HostScenario, runLead } from './deliver-lead/fake-host.mts';
import { create } from './deliver/tracker/fake.mts';

const root = path.resolve(__dirname, '../../..');
const stepScript = path.join(root, 'skills/delivery/deliver-lead/scripts/step.mts');
const trackerDir = path.resolve(__dirname, 'deliver/tracker');
const profile = profileValidator(
  'deliver@2',
  'skills/delivery/deliver/schema/deliver-profile.schema.json',
);

const ISSUES = [
  { number: 12, title: '[PBI] feat: leaf step', labels: ['pbi'], body: 'Tier: strong' },
  { number: 13, title: '[Bug] fix: broken login', labels: ['bug', 'hotfix'], body: '' },
];

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
  dir = mkdtempSync(path.join(tmpdir(), 'deliver-lead-leaf-'));
  const origin = path.join(dir, 'origin.git');
  const seed = path.join(dir, 'seed');
  repo = path.join(dir, 'repo');
  fakeDir = path.join(dir, 'fake');
  eventsDir = path.join(dir, 'events');
  mkdirSync(fakeDir);
  execFileSync('git', ['init', '-q', '--bare', origin]);
  execFileSync('git', ['init', '-q', '-b', 'main', seed]);
  const commit = (message: string) =>
    git(seed, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', message);
  commit('first');
  git(seed, 'push', '-q', origin, 'main', 'main:release/next');
  // a hotfix forks from main, which moved on since the checkout of the lead
  commit('fix on main');
  git(seed, 'push', '-q', origin, 'main');
  execFileSync('git', ['clone', '-q', '--branch', 'release/next', origin, repo]);
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

beforeEach(() => {
  for (const name of readdirSync(fakeDir)) rmSync(path.join(fakeDir, name), { force: true });
});

/** One run of the lead for `issue`: every action is asked twice and must not change on the repeat. */
async function lead(
  issue: number,
  { tracker = {}, host = {} }: { tracker?: object; host?: HostScenario } = {},
) {
  writeFileSync(
    path.join(fakeDir, 'scenario.json'),
    JSON.stringify({ items: [], repositories: { 'fake/repo': { issues: ISSUES } }, ...tracker }),
  );
  const context = { cwd: repo, selection: {}, trustAuthors: false };
  const fake = create({ ...context, base: 'release/next' });
  const record = (call: Record<string, unknown>) =>
    writeFileSync(path.join(fakeDir, 'calls.jsonl'), `${JSON.stringify(call)}\n`, { flag: 'a' });
  // every gate call goes into the log of the fake tracker, before the gate runs
  const gates = Object.fromEntries(
    Object.entries(GATES).map(([name, gate]) => [
      name,
      (...args: unknown[]) => {
        record({ call: 'gate', gate: name });
        return (gate as (...a: unknown[]) => unknown)(...args);
      },
    ]),
  ) as unknown as LeafGates;
  const run = uuid7();
  const step = (result: StepResult | undefined) =>
    leafStep({
      tracker: fake,
      trackerAt: (base) => (base === 'release/next' ? fake : create({ ...context, base })),
      events: eventsDir,
      issue,
      run,
      result,
      cwd: repo,
      layers: [],
      gates,
    });
  const eventFile = path.join(eventsDir, `${run}.jsonl`);
  const outcome = await runLead(step, { fakeDir, issue, scenario: host }, async (action, again) => {
    const written = lines(eventFile).length;
    // idempotent: the same state and result give the same action and write nothing
    expect(await again()).toEqual(action);
    expect(lines(eventFile)).toHaveLength(written);
  });
  const events = lines(eventFile) as ProfileEvent[];
  return {
    ...outcome,
    events,
    calls: lines(path.join(fakeDir, 'calls.jsonl')),
    stages: lines(path.join(fakeDir, 'stages.jsonl')).map((line) => line.stage),
    merges: lines(path.join(fakeDir, 'merges.jsonl')),
  };
}

const starts = (actions: Action[]) =>
  actions.filter((a): a is Extract<Action, { do: 'start-worker' }> => a.do === 'start-worker');

describe('leafStep on the pass path', () => {
  it('delivers a PBI: implementing, review, approved, merged through every gate', async () => {
    const out = await lead(12);
    expect(out.actions.map((a) => a.do)).toEqual([
      'start-worker',
      'wait-any',
      'read-result',
      'start-worker',
      'wait-any',
      'read-result',
      'end',
    ]);
    const [implementer, reviewer] = starts(out.actions);
    expect(implementer).toMatchObject({
      role: 'implementer',
      branch: 'feat/12-leaf-step',
      base: 'release/next',
      model: 'opus',
    });
    expect(implementer!.brief).toContain('`/deliver 12 --base release/next`');
    expect(implementer!.brief).not.toContain('--merged-meanwhile-file');
    expect(reviewer).toMatchObject({ role: 'reviewer', head: 'abc123', model: 'opus' });
    expect(reviewer!.brief).toContain(
      '`/deliver-review 12 --base release/next --pr https://example.test/pull/112`',
    );
    expect(reviewer!.env.DELIVER_REVIEW_FILE).toMatch(/deliver\/[^/]+\/12\.review-1\.json$/);
    expect(out.actions.find((a) => a.do === 'wait-any')).toMatchObject({ timeout: 5400 });
    expect(out.report).toEqual({
      issue: 12,
      outcome: 'merged',
      reason: 'merged',
      pr: 'https://example.test/pull/112',
    });
    // merged: no agent:* label is left
    expect(out.stages).toEqual(['implementing', 'review', 'approved', null]);
    const order = out.calls.map((c) => (c.call === 'gate' ? c.gate : c.call));
    expect(order).toEqual([
      'stage',
      'mergeBase',
      'mergedMeanwhile',
      'stage',
      'verifyVerdict',
      'stage',
      'guard',
      'mergeApproved',
      'merge',
      'stage',
    ]);
    expect(out.merges).toEqual([
      { pull: 112, head: 'abc123', base: 'release/next', title: 'fake #112' },
    ]);
    profile.expectRun(out.events);
    expect(out.events.map((e) => e.type)).toEqual([
      'run.started',
      'task.started',
      'step.started',
      'deliver.worker',
      'step.finished',
      'step.started',
      'deliver.worker',
      'step.finished',
      'step.started',
      'step.finished',
      'deliver.merged',
      'task.finished',
    ]);
    expect(out.events.find((e) => e.type === 'deliver.merged')).toMatchObject({
      deliver: { repo: 'fake/repo', issue: 12, pr: 'https://example.test/pull/112', risk: 'low' },
    });
    expect(out.events.filter((e) => e.type === 'step.finished')[1]).toMatchObject({
      task: 'issue-12',
      step: { name: 'review-1', n: 1, text: 'review round 1: approve' },
    });
  });

  it('delivers a hotfix Bug against main with the branch of merge-base', async () => {
    const out = await lead(13, { tracker: { pullBases: ['main'] } });
    const [implementer, reviewer] = starts(out.actions);
    expect(implementer).toMatchObject({ branch: 'fix/13-broken-login', base: 'main' });
    // main moved since the fork point of the checkout: the implementer gets the list
    expect(implementer!.brief).toMatch(
      /`\/deliver 13 --base main --merged-meanwhile-file \S+13\.merged-meanwhile\.md`/,
    );
    expect(reviewer!.brief).toContain('--base main --pr https://example.test/pull/113');
    expect(out.report).toMatchObject({ outcome: 'merged', backmerge: 'main→release/next' });
    expect(out.merges).toEqual([
      { pull: 113, head: 'abc123', base: 'main', title: 'fake #113' },
    ]);
    profile.expectRun(out.events);
  });
});

describe('leafStep off the pass path', () => {
  it.each([
    ['verify-verdict', 'fail', { host: { reviewer: { verdict: 'changes' } } }],
    ['guard', 'owner', { tracker: { files: ['.github/workflows/ci.yml'] } }],
    ['merge-approved', 'retry', { tracker: { gates: [{ state: 'pending', reported: false }] } }],
  ] as const)('ends at %s with its word %s and merges nothing', async (gate, word, options) => {
    const out = await lead(12, options as Parameters<typeof lead>[1]);
    expect(out.report).toMatchObject({ outcome: 'ended', gate, result: word });
    expect(out.report.reason).toMatch(new RegExp(`^${gate}: `));
    expect(out.merges).toEqual([]);
    expect(out.stages).not.toContain(null);
    profile.expectRun(out.events);
    expect(out.events.at(-1)).toMatchObject({ type: 'task.finished', outcome: 'skipped' });
  });

  it('ends without a pull request, and for a worker that is blocked', async () => {
    const none = await lead(12, { host: { implementer: { noPull: true } } });
    expect(none.report).toMatchObject({ reason: 'session ended without a pull request' });
    const blocked = await lead(12, { host: { reviewer: { state: 'blocked' } } });
    expect(blocked.report.reason).toBe('the reviewer is blocked: which option?');
    expect([...none.merges, ...blocked.merges]).toEqual([]);
  });
});

describe('the actions', () => {
  // the verb ids of the contract between a workflow skill and its host adapters
  const verbs = [
    ...readFileSync(path.join(root, 'skills/delivery/deliver/references/host-verbs.md'), 'utf8')
      .split('## Verbs')[1]!
      .split('## Wake')[0]!
      .matchAll(/^\| `([a-z-]+)`/gm),
  ].map((m) => m[1]);
  const hostTools = [
    'start_agent',
    'wait_any',
    'wait_agent',
    'read_agent',
    'prompt_agent',
    'report_done',
    'record_run',
    'worker-start',
    'worker_done',
    'Agent tool',
    'isolation',
  ];

  it('are verbs of host-verbs.md or end, and name no host tool', async () => {
    expect(verbs).toEqual(['start-worker', 'wait-any', 'read-result', 'answer-worker', 'ask-owner']);
    const { actions } = await lead(12);
    for (const action of actions) expect([...verbs, 'end']).toContain(action.do);
    const text = JSON.stringify(actions);
    for (const tool of hostTools) expect(text).not.toContain(tool);
  });
});

describe('step.mts', () => {
  it('prints the first action as one JSON line, and usage for a wrong flow', async () => {
    writeFileSync(
      path.join(fakeDir, 'scenario.json'),
      JSON.stringify({ items: [], repositories: { 'fake/repo': { issues: ISSUES } } }),
    );
    mkdirSync(path.join(repo, '.agents'), { recursive: true });
    writeFileSync(path.join(repo, '.agents/config.json'), JSON.stringify({ deliver: { tracker: 'fake' } }));
    const env = { ...process.env };
    const run = uuid7();
    const out = execFileSync(process.execPath, [stepScript, 'leaf', '12', '--run', run], {
      cwd: repo,
      env,
      encoding: 'utf8',
    });
    expect(out.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(out)).toMatchObject({ do: 'start-worker', role: 'implementer' });
    await expect(runGate(stepScript, ['tree', '12', '--run', run], { cwd: repo, env })).resolves.toMatchObject({
      result: 'usage',
    });
    rmSync(path.join(repo, '.agents'), { recursive: true, force: true });
  });
});
