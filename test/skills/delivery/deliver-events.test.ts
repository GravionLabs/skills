// The events an orchestrator reacts to (merged, handover, aside, milestone-done), run against the fake harness.
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixture, loop, type Outcome, READY } from './deliver/run-loop.ts';

const { reasonCode, uuid7 } = (await import(
  path.resolve(__dirname, '../../../skills/delivery/deliver/scripts/events.mts')
)) as typeof import('../../../skills/delivery/deliver/scripts/events.mts');

type Event = Record<string, unknown> & { type: string; v: number; seq: number; run: string };
const events = (out: Outcome) => out.events as unknown as Event[];
const of = (out: Outcome, type: string) => events(out).filter((e) => e.type === type);
const UUID7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('deliver loop events', () => {
  fixture();

  it('writes merged once per issue with its risk, in one gapless run with a UUIDv7', async () => {
    const out = await loop(
      {
        items: [
          { id: 11, title: '[PBI] feat: first' },
          { id: 12, title: '[PBI] feat: second' },
        ],
        risks: { 11: 'high' },
      },
      { args: ['--merge-risk', 'high'] },
    );
    expect(out.status).toBe(0);
    const merged = of(out, 'merged');
    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      repo: 'fake/repo',
      issue: 11,
      pr: 'https://example.test/pull/111',
      risk: 'high',
      tone: 'success',
    });
    // no result file: the risk is unknown, not invented
    expect(merged[1]).not.toHaveProperty('risk');
    const all = events(out);
    const run = all[0]!.run;
    expect(run).toMatch(UUID7);
    expect(out.stdout).toContain(`events: run ${run}`);
    expect(all[0]).toMatchObject({
      type: 'run.started',
      origin: {
        repo: expect.any(String),
        worktree: expect.any(String),
        host: os.hostname(),
      },
    });
    expect(all.map((e) => [e.v, e.run, e.seq])).toEqual(all.map((_, i) => [1, run, i + 1]));
    // no milestone: no end of a milestone
    expect(of(out, 'milestone-done')).toEqual([]);
  });

  it('writes handover with its reason and milestone-done without a release pull request', async () => {
    const out = await loop(
      { items: [{ id: 21, title: '[PBI] ci: workflow' }], files: ['.github/workflows/ci.yml'] },
      { milestone: true },
    );
    expect(out.status).toBe(3);
    expect(of(out, 'handover')).toEqual([
      expect.objectContaining({
        repo: 'fake/repo',
        issue: 21,
        pr: 'https://example.test/pull/121',
        reason: 'protected-paths',
        text: expect.stringContaining('.github/workflows/ci.yml'),
      }),
    ]);
    expect(of(out, 'aside')).toEqual([]);
    expect(of(out, 'merged')).toEqual([]);
    const done = of(out, 'milestone-done');
    expect(done).toEqual([
      expect.objectContaining({ milestone: 'M001', merged: 0, aside: 0, tone: 'warning' }),
    ]);
    expect(done[0]).not.toHaveProperty('pr');
  });

  it('writes aside with the hold label of an issue that waits for a decision', async () => {
    const out = await loop({
      items: [{ id: 31, title: '[PBI] feat: unclear' }],
      needsDecision: true,
    });
    expect(out.status).toBe(2);
    expect(of(out, 'aside')).toEqual([
      expect.objectContaining({ issue: 31, reason: 'needs-decision', hold: 'needs-decision' }),
    ]);
  });

  it('writes aside without a hold label for a failed session', async () => {
    const out = await loop({ items: [{ id: 32, title: '[PBI] feat: fails' }], exits: [3] });
    const [aside] = of(out, 'aside');
    expect(aside).toMatchObject({ issue: 32, reason: 'session-failed' });
    expect(aside).not.toHaveProperty('hold');
  });

  it('ends a milestone run with milestone-done and the release pull request', async () => {
    const out = await loop({ items: [{ id: 41, title: '[PBI] feat: last' }] }, { milestone: true });
    expect(out.status).toBe(0);
    expect(of(out, 'milestone-done')).toEqual([
      expect.objectContaining({
        repo: 'fake/repo',
        milestone: 'M001',
        merged: 1,
        aside: 0,
        pr: expect.stringMatching(/^https:/),
        tone: 'success',
      }),
    ]);
    expect(
      events(out)
        .slice(-2)
        .map((e) => e.type),
    ).toEqual(['milestone-done', 'run.finished']);
  });

  it('writes merged and a closed aside for pull requests a person decided during the wait', async () => {
    const wait = { args: ['--handover-minutes', '120'] };
    const scenario = { files: ['.github/workflows/ci.yml'] };
    const merged = await loop(
      {
        items: [{ id: 51, title: '[PBI] ci: workflow' }],
        ...scenario,
        gates: [READY, READY, { state: 'merged' }],
      },
      wait,
    );
    expect(of(merged, 'merged')).toEqual([expect.objectContaining({ issue: 51 })]);
    const closed = await loop(
      {
        items: [{ id: 52, title: '[PBI] ci: workflow' }],
        ...scenario,
        gates: [READY, READY, { state: 'closed' }],
      },
      wait,
    );
    expect(of(closed, 'aside')).toEqual([expect.objectContaining({ issue: 52, reason: 'closed' })]);
  });
});

describe('reasonCode', () => {
  it.each([
    ['needs-decision: review still asks for changes', 'needs-decision'],
    ['session failed (exit 3) (session: blocked changes protected paths)', 'session-failed'],
    ['conflict repaired, changes protected paths (a)', 'protected-paths'],
    ['conflict with main', 'conflict'],
    ['more than one open pull request (a, b)', 'multiple-pulls'],
    ['pushed after the review', 'pushed-after-review'],
    ['red: ci', 'checks-red'],
    ['something new', 'other'],
  ])('%s -> %s', (reason, code) => {
    expect(reasonCode(reason)).toBe(code);
  });

  it('builds a UUIDv7 that starts with the time', () => {
    expect(uuid7(0x0192_0000_0000)).toMatch(/^01920000-0000-7/);
    expect(uuid7()).toMatch(UUID7);
  });
});
