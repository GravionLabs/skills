// The limits gate (#1166): counts the counted sessions of a run from its events, per kind, issue and run.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  LIMITS,
  type RunEvent,
  limits,
  readRunEvents,
} from '../../../skills/delivery/deliver/scripts/gates/limits.mts';
import { runGate } from '../../../skills/delivery/deliver/scripts/gates/result.mts';
import { profileValidator, type ProfileEvent } from '../../helpers/agent-events-profile.ts';
import { fixture, loop } from './deliver/run-loop.ts';

const GATE = path.resolve(__dirname, '../../../skills/delivery/deliver/scripts/gates/limits.mts');
const RUN = '019ac000-0000-7000-8000-000000000001';

const counted = (task: string, kind: string, n?: number, repo?: string): RunEvent => ({
  type: 'step.started',
  task,
  step: { name: `${kind}-x`, ...(n !== undefined && { n }) },
  deliver: { counted: kind, ...(repo && { repo }) },
});
const reviewed = (task: string, round: number): RunEvent => ({
  type: 'step.finished',
  task,
  step: { name: `review-${round}`, text: `review round ${round}: changes` },
});

// issue 7: two fix rounds, one timeout retry, one conflict repair; round 1 used its review retry, round 2 runs
// issue 8: nothing counted yet, only events of other kinds
const FIXTURE: RunEvent[] = [
  { type: 'run.started', profiles: ['deliver@2'] },
  { type: 'task.started', task: 'issue-7' },
  counted('issue-7', 'timeout'),
  counted('issue-7', 'review', 1),
  reviewed('issue-7', 1),
  counted('issue-7', 'fix', 1),
  reviewed('issue-7', 2),
  counted('issue-7', 'fix', 2),
  counted('issue-7', 'conflict'),
  { type: 'step.started', task: 'issue-8', step: { name: 'other' } },
  { type: 'deliver.sessions', deliver: { running: 1 } },
];

describe('limits', () => {
  it('passes every kind while the count is below the limit', () => {
    for (const kind of Object.keys(LIMITS))
      expect(limits({ events: FIXTURE, issue: 8, kind })).toMatchObject({
        result: 'pass',
        evidence: { kind, issue: 8, count: 0, limit: LIMITS[kind as keyof typeof LIMITS] },
      });
  });

  it('hands fix rounds to the owner with the needs-decision reason of the loop', () => {
    expect(limits({ events: FIXTURE, issue: 7, kind: 'fix' })).toEqual({
      result: 'owner',
      reason: 'needs-decision: review still asks for changes after 2 fix rounds',
      evidence: { kind: 'fix', issue: 7, count: 2, limit: 2 },
    });
    const one = FIXTURE.filter(
      (e) => !(e.type === 'step.started' && (e.step as { n?: number }).n === 2),
    );
    expect(limits({ events: one, issue: 7, kind: 'fix' })).toMatchObject({
      result: 'pass',
      reason: 'fix 2 of 2 allowed',
    });
  });

  it('counts timeouts and conflict repairs per issue and run', () => {
    expect(limits({ events: FIXTURE, issue: 7, kind: 'timeout' })).toMatchObject({
      result: 'owner',
      reason: 'session timeout',
      evidence: { count: 1, limit: 1 },
    });
    expect(limits({ events: FIXTURE, issue: 7, kind: 'conflict' }).result).toBe('owner');
  });

  it('counts review retries per review round', () => {
    // round 3 runs: the retry of round 1 does not count
    expect(limits({ events: FIXTURE, issue: 7, kind: 'review' })).toMatchObject({
      result: 'pass',
      evidence: { round: 3, count: 0 },
    });
    const inRound = [...FIXTURE, counted('issue-7', 'review', 3)];
    expect(limits({ events: inRound, issue: 7, kind: 'review' })).toMatchObject({
      result: 'owner',
      evidence: { round: 3, count: 1, limit: 1 },
    });
  });

  it('is usage for an unknown kind or issue', () => {
    expect(limits({ events: FIXTURE, issue: 7, kind: 'merge' })).toMatchObject({
      result: 'usage',
      reason: expect.stringContaining('fix, review, conflict, timeout'),
    });
    expect(limits({ events: FIXTURE, issue: 0, kind: 'fix' }).result).toBe('usage');
  });

  it('scopes an Objective run to the repository of the task', () => {
    const objective = [
      counted('a/one:issue-7', 'conflict', undefined, 'a/one'),
      counted('a/two:issue-7', 'timeout', undefined, 'a/two'),
    ];
    expect(limits({ events: objective, issue: 7, kind: 'conflict', repo: 'a/one' }).result).toBe(
      'owner',
    );
    expect(limits({ events: objective, issue: 7, kind: 'conflict', repo: 'a/two' }).result).toBe(
      'pass',
    );
    expect(limits({ events: objective, issue: 7, kind: 'timeout' }).result).toBe('owner');
  });
});

describe('limits CLI', () => {
  let dir: string;
  const env = () => ({ ...process.env, AGENT_EVENTS_DIR: dir });

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gate-limits-'));
    // an incomplete last line, as a writer leaves it mid-append, does not count
    writeFileSync(
      path.join(dir, `${RUN}.jsonl`),
      `${FIXTURE.map((e) => JSON.stringify(e)).join('\n')}\n{"type":"step.sta`,
    );
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the events of the run file', () => {
    expect(readRunEvents(dir, RUN)).toHaveLength(FIXTURE.length);
    expect(readRunEvents(dir, 'missing')).toBeUndefined();
  });

  it('answers pass, owner and usage from the run file', async () => {
    await expect(runGate(GATE, [RUN, '8', 'fix'], { env: env() })).resolves.toMatchObject({
      result: 'pass',
    });
    await expect(runGate(GATE, [RUN, '7', 'fix'], { env: env() })).resolves.toMatchObject({
      result: 'owner',
      reason: 'needs-decision: review still asks for changes after 2 fix rounds',
    });
    await expect(runGate(GATE, [RUN, '7', 'merge'], { env: env() })).resolves.toMatchObject({
      result: 'usage',
    });
    // counting is scoped to the run: another run has no events of its own here
    await expect(
      runGate(GATE, ['019ac000-0000-7000-8000-000000000002', '7', 'fix'], { env: env() }),
    ).resolves.toMatchObject({ result: 'usage', reason: expect.stringContaining('no events') });
    await expect(runGate(GATE, [RUN, 'x7', 'fix'], { env: env() })).resolves.toMatchObject({
      result: 'usage',
    });
  });
});

describe('limits in the loop', () => {
  fixture();
  const profile = profileValidator(
    'deliver@2',
    'skills/delivery/deliver/schema/deliver-profile.schema.json',
  );

  it('writes one counted event per fix round before its session and stops at the limit', async () => {
    const out = await loop({
      items: [{ id: 51, title: '[PBI] feat: reviewed' }],
      verdicts: ['changes', 'changes', 'changes'],
    });
    expect(out.status).toBe(2);
    profile.expectRun(out.events as unknown as ProfileEvent[]);
    const events = out.events as unknown as RunEvent[];
    const fixes = events.filter((e) => e.type === 'step.started');
    expect(fixes).toEqual([
      expect.objectContaining({
        task: 'issue-51',
        step: { name: 'fix-1', n: 1, text: 'fix round 1 of 2' },
        deliver: { counted: 'fix' },
      }),
      expect.objectContaining({ step: expect.objectContaining({ name: 'fix-2', n: 2 }) }),
    ]);
    // each one precedes the review round of its fix session
    const at = (pred: (e: RunEvent) => boolean) => events.findIndex(pred);
    const round = (n: number) =>
      at((e) => e.type === 'step.finished' && (e.step as { name?: string }).name === `review-${n}`);
    expect(at((e) => e === fixes[0])).toBeLessThan(round(2));
    expect(at((e) => e === fixes[1])).toBeLessThan(round(3));
    // the file of the run answers the same as the loop
    expect(limits({ events, issue: 51, kind: 'fix' }).result).toBe('owner');
  });
});
