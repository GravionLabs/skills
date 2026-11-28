import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  releaseGate,
  retroMarker,
} from '../../../skills/delivery/deliver/scripts/gates/release-gate.mts';
import { runGate } from '../../../skills/delivery/deliver/scripts/gates/result.mts';
import type { Item, Tracker } from '../../../skills/delivery/deliver/scripts/tracker.mts';
import { create } from '../../../skills/delivery/deliver/scripts/tracker/github.mts';
import { createFakeGh } from '../../helpers/fake-gh';
import { fixture, loop, skill } from './deliver/run-loop';

const item = (id: number): Item => ({ id, title: 't', url: 'u', labels: [], body: '' });
const pull = { id: 5, title: 'p', url: 'https://x/pull/5', branch: 'feat/5-x' };
const release = { id: 9, title: 'r', url: 'https://x/pull/9', branch: 'release/next' };

/** A tracker with only the reads of the gate: a write call would be a TypeError. */
const tracker = (reads: Partial<Tracker> = {}): Tracker =>
  ({
    items: () => [],
    publishState: () => ({ state: 'ok' }),
    foreignPulls: () => [],
    releaseTests: () => [],
    releasePull: () => undefined,
    gate: () => ({ state: 'pending', reported: true }),
    retroComment: () => undefined,
    ...reads,
  }) as Tracker;
const gate = (reads?: Partial<Tracker>) =>
  releaseGate({ tracker: tracker(reads), milestone: 'M001' });
const broken = (message: string) => () => {
  throw Object.assign(new Error('gh'), { stderr: message });
};

describe('releaseGate', () => {
  it('passes with nothing open and tells that the retro is not done', () => {
    expect(gate()).toMatchObject({
      result: 'pass',
      evidence: { open: [], pulls: [], releaseTests: [], retroDone: false, unread: {} },
    });
  });

  it('tells that the retro is done, found by the marker of the milestone', () => {
    const retroComment = vi.fn<Tracker['retroComment']>(() => 'https://x/c1');
    expect(
      releaseGate({ tracker: tracker({ retroComment }), milestone: 'M001 (1.2.0)' }),
    ).toMatchObject({ result: 'pass', evidence: { retroDone: true, retro: 'https://x/c1' } });
    expect(retroComment).toHaveBeenCalledWith('<!-- retro: M001 -->');
    expect(retroMarker('M001')).toBe('<!-- retro: M001 -->');
  });

  it('passes while the release pull request is not ready or no check has reported', () => {
    for (const state of [
      { state: 'pending', reported: true },
      { state: 'ready', reported: false, head: 'a' },
    ] as const)
      expect(gate({ releasePull: () => release, gate: () => state }).result).toBe('pass');
  });

  it('retries while leaves are open and reads nothing further', () => {
    const foreignPulls = vi.fn<Tracker['foreignPulls']>(() => []);
    expect(gate({ items: () => [item(3), item(4)], foreignPulls })).toMatchObject({
      result: 'retry',
      reason: 'open in M001: #3, #4',
      evidence: { open: [3, 4] },
    });
    expect(foreignPulls).not.toHaveBeenCalled();
  });

  it('retries while a publish job runs', () => {
    expect(
      gate({ publishState: () => ({ state: 'running', url: 'https://x/job/1' }) }),
    ).toMatchObject({ result: 'retry', evidence: { job: 'https://x/job/1', retroDone: false } });
  });

  it.each([
    ['nothing open', []],
    ['open leaves', [item(3)]],
  ])('fails for a failed publish job with %s and names the job', (_name, items) => {
    expect(
      gate({
        items: () => items,
        publishState: () => ({ state: 'failed', url: 'https://x/job/2' }),
      }),
    ).toMatchObject({ result: 'fail', evidence: { job: 'https://x/job/2' } });
  });

  it.each<[string, Partial<Tracker>, string]>([
    ['a foreign pull request', { foreignPulls: () => [pull] }, pull.url],
    ['an open release test', { releaseTests: () => [item(7)] }, 'release test #7 is open'],
    [
      'a ready release pull request',
      { releasePull: () => release, gate: () => ({ state: 'ready', reported: true, head: 'a' }) },
      `${release.url} is ready`,
    ],
  ])('leaves it to the owner with %s', (_name, reads, reason) => {
    const out = gate(reads);
    expect(out.result).toBe('owner');
    expect(out.reason).toContain(reason);
    expect(out.evidence.retroDone).toBe(false);
  });

  it.each([
    ['fail', 'HTTP 500'],
    ['retry', 'API rate limit exceeded'],
  ])('answers %s for a failed read (%s) and still reads the rest', (word, message) => {
    const out = gate({ foreignPulls: broken(message) });
    expect(out).toMatchObject({
      result: word,
      reason: `pulls not read: ${message}`,
      evidence: { releaseTests: [], retroDone: false },
    });
  });

  it('does not call a retro open that it could not read', () => {
    const out = gate({ retroComment: broken('HTTP 502') });
    expect(out.result).toBe('fail');
    expect(out.evidence.retroDone).toBeUndefined();
  });
});

describe('release-gate.mts', () => {
  const script = path.join(skill, 'scripts/gates/release-gate.mts');
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'release-gate-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads through the tracker of the named repository', async () => {
    writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify({ items: [] }));
    const out = await runGate(script, ['o/r', '--milestone', 'M001', '--tracker', 'fake'], {
      cwd: dir,
      env: {
        ...process.env,
        FAKE_DIR: dir,
        DELIVER_TRACKER_DIR: path.join(__dirname, 'deliver/tracker'),
      },
    });
    expect(out).toMatchObject({ result: 'pass', evidence: { retroDone: false } });
  });

  it.each([[[]], [['o/r']], [['no-slash', '--milestone', 'M001']]])(
    'is a usage error with %j',
    async (args) => {
      expect((await runGate(script, args, { cwd: dir })).result).toBe('usage');
    },
  );
});

describe('GitHub tracker: release reads (fake gh)', () => {
  let dir: string;
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });
  const github = (handler: string) => {
    dir = mkdtempSync(path.join(tmpdir(), 'release-gate-gh-'));
    const fake = createFakeGh(dir, handler);
    for (const [k, v] of Object.entries(fake.env())) if (v !== undefined) vi.stubEnv(k, v);
    return create({
      cwd: dir,
      repo: 'o/r',
      base: 'release/next',
      selection: { milestone: 'M001' },
      trustAuthors: false,
    });
  };

  const run = (id: number, status = 'completed', workflow = 1, event = 'push') => ({
    id,
    workflow_id: workflow,
    event,
    status,
    html_url: `run/${id}`,
  });
  const job = (name: string, conclusion: string | null, status = 'completed') => ({
    name,
    status,
    conclusion,
    html_url: `job/${name}`,
  });
  const publish = (runs: unknown[], jobs: Record<number, unknown[]>) =>
    github(`(call) => {
      if (call.args[0] === 'repo') return { rest: 'main' };
      const route = call.args[1];
      if (route.includes('/actions/runs?branch=main')) return { rest: { workflow_runs: ${JSON.stringify(runs)} } };
      const id = /runs\\/(\\d+)\\/jobs/.exec(route)[1];
      return { rest: { jobs: ${JSON.stringify(jobs)}[id] || [] } };
    }`).publishState();

  it.each<[string, unknown[], Record<number, unknown[]>, unknown]>([
    [
      'the failed publish job of the latest release run',
      [run(3, 'completed', 2), run(2), run(1)],
      {
        3: [job('Lint', 'failure')],
        2: [job('Release', 'failure')],
        1: [job('Release', 'success')],
      },
      { state: 'failed', url: 'job/Release' },
    ],
    [
      'a running publish job',
      [run(2, 'in_progress')],
      { 2: [job('publish', null, 'in_progress')] },
      { state: 'running', url: 'job/publish' },
    ],
    [
      'a newer run of the release workflow before its publish job',
      [run(2, 'in_progress'), run(1)],
      { 2: [job('Test', null, 'in_progress')], 1: [job('Release', 'failure')] },
      { state: 'running', url: 'run/2' },
    ],
    [
      'a green run, past a run that skipped the job and a scheduled one',
      [run(3, 'completed', 1, 'schedule'), run(2), run(1)],
      {
        3: [job('Release', 'failure')],
        2: [job('Release', 'skipped')],
        1: [job('Release', 'success')],
      },
      { state: 'ok' },
    ],
    ['no release run', [run(1)], { 1: [job('Test', 'failure')] }, { state: 'none' }],
  ])('reads the publish state: %s', (_name, runs, jobs, state) => {
    expect(publish(runs, jobs)).toEqual(state);
  });

  it('finds the newest retro comment of an author with write access or an app', () => {
    const comment = (id: number, author_association: string, type = 'User', body = 'M001') => ({
      html_url: `c/${id}`,
      body: `<!-- retro: ${body} -->\nreport`,
      author_association,
      user: { type },
    });
    const comments = [
      comment(1, 'OWNER'),
      comment(2, 'NONE', 'Bot'),
      comment(3, 'NONE'),
      comment(4, 'OWNER', 'User', 'M002'),
    ];
    const made = github(`(call) => {
      const route = call.args[1];
      if (route.includes('/milestones')) return { rest: [[{ number: 1, title: 'M001', created_at: '2026-01-01T00:00:00Z' }]] };
      if (!route.endsWith('since=2026-01-01T00:00:00Z')) throw new Error(route);
      return { rest: [${JSON.stringify(comments)}] };
    }`);
    expect(made.retroComment('<!-- retro: M001 -->')).toBe('c/2');
    expect(made.retroComment('<!-- retro: M003 -->')).toBeUndefined();
  });

  it('reads the open release pull request without creating one', () => {
    const made = github(`(call) => {
      if (call.args[0] === 'repo') return { rest: 'main' };
      if (!call.args[1].includes('base=main&head=o:release/next')) throw new Error('route');
      return { rest: [[]] };
    }`);
    expect(made.releasePull()).toBeUndefined();
  });
});

describe('retro once per release (loop)', () => {
  fixture();

  it('does not run it again and links the posted comment', async () => {
    const scenario = { items: [{ id: 31, title: '[PBI] feat: last' }] };
    const first = await loop(scenario, { milestone: true });
    expect(first.retros).toHaveLength(1);
    const again = await loop(
      { items: [], releaseCommits: 1 },
      { milestone: true, resume: first.dir },
    );
    expect(again.status).toBe(0);
    expect(again.retros).toHaveLength(1);
    expect(again.calls.filter((call) => call === 'linkRetro')).toHaveLength(2);
    expect(again.final).toMatchObject({ retro: 'https://example.test/issues/7#issuecomment-1' });
  });
});
