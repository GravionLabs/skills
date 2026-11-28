// deliver: up to `deliver.parallel` role sessions at once (default 1), each issue in its own worktree, merges one at a
// time per base branch (#1121). The limits themselves: parallel.mts.
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { type ProfileEvent, profileValidator } from '../../helpers/agent-events-profile';
import { type Span, fixture, loop, repo, skill } from './deliver/run-loop';

const { MergeLocks, Slots } = (await import(
  path.join(skill, 'scripts/parallel.mts')
)) as typeof import('../../../skills/delivery/deliver/scripts/parallel.mts');

fixture();
const profile = profileValidator(
  'deliver@2',
  'skills/delivery/deliver/schema/deliver-profile.schema.json',
);
const config = (deliver: object) => {
  mkdirSync(path.join(repo, '.agents'), { recursive: true });
  writeFileSync(path.join(repo, '.agents/config.json'), JSON.stringify({ deliver }));
};
afterEach(() => rmSync(path.join(repo, '.agents'), { recursive: true, force: true }));

const item = (id: number, blockedBy?: number[]) => ({
  id,
  title: `[PBI] feat: item ${id}`,
  ...(blockedBy && { blockedBy }),
});
const overlap = (a: Span, b: Span) => a.at < b.end && b.at < a.end;
/** The most sessions that ran at the same moment. */
const peak = (spans: Span[]) =>
  Math.max(0, ...spans.map((s) => spans.filter((other) => overlap(s, other)).length));
const implementers = (spans: Span[], id: number) => spans.filter((s) => s.id === id && !s.review);

describe('Slots and MergeLocks', () => {
  it('lets at most `limit` holders in, the next one when a slot is freed', async () => {
    const heard: number[] = [];
    const slots = new Slots(2, (active) => heard.push(active));
    const a = await slots.acquire();
    await slots.acquire();
    let third = false;
    const waiting = slots.acquire().then((free) => {
      third = true;
      return free;
    });
    await Promise.resolve();
    expect([slots.active, third]).toEqual([2, false]);
    a();
    a();
    (await waiting)();
    expect([slots.active, third]).toEqual([1, true]);
    expect(heard).toEqual([1, 2, 2, 1]);
    expect(() => new Slots(0)).toThrow();
  });

  it('shares the slots of an Objective: each view counts its own holders within the shared limit', async () => {
    const shared = new Slots(2);
    const heard: number[] = [];
    const [app, lib] = [shared.within(3, (active) => heard.push(active)), shared.within(3)];
    expect(app.limit).toBe(2);
    const freeApp = await app.acquire();
    const freeLib = await lib.acquire();
    expect([shared.active, app.active, lib.active]).toEqual([2, 1, 1]);
    let third = false;
    const waiting = app.acquire().then((free) => {
      third = true;
      return free;
    });
    await Promise.resolve();
    expect(third).toBe(false);
    freeLib();
    (await waiting)();
    freeApp();
    expect([shared.active, app.active, lib.active]).toEqual([0, 0, 0]);
    expect(heard).toEqual([1, 2, 1, 0]);
  });

  it('keeps a view within its own limit and leaves the other shared slots free', async () => {
    const shared = new Slots(2);
    const [app, lib] = [shared.within(1), shared.within(1)];
    const freeApp = await app.acquire();
    let second = false;
    const waiting = app.acquire().then((free) => {
      second = true;
      return free;
    });
    const freeLib = await lib.acquire();
    expect([app.limit, shared.active, second]).toEqual([1, 2, false]);
    freeApp();
    (await waiting)();
    freeLib();
    expect([shared.active, app.active, lib.active]).toEqual([0, 0, 0]);
  });

  it('keeps one lock per repository and base branch', async () => {
    const locks = new MergeLocks();
    expect(locks.of('o/r', 'main')).toBe(locks.of('o/r', 'main'));
    expect(locks.of('o/r', 'main')).not.toBe(locks.of('o/r', 'release/next'));
    expect(locks.of('o/r', 'main').limit).toBe(1);
    const order: string[] = [];
    const lock = locks.of('o/r', 'main');
    let release = () => {};
    const held = new Promise<void>((done) => {
      release = done;
    });
    const first = lock.run(async () => {
      await held;
      order.push('first');
    });
    const second = lock.run(async () => order.push('second'));
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });
});

describe('deliver loop: parallel sessions', () => {
  it('runs one session at a time without config', async () => {
    const out = await loop(
      { items: [item(31), item(32)], sessionMs: 150 },
      { parallel: 'default' },
    );
    expect(out.status).toBe(0);
    expect(peak(out.spans)).toBe(1);
    expect(out.log).toContain('parallel: up to 1 sessions at once');
  });

  it('keeps two sessions with deliver.parallel 2', async () => {
    config({ parallel: 2, maxSessions: 1 });
    const out = await loop(
      { items: [item(33), item(34)], sessionMs: 400 },
      { parallel: 'default' },
    );
    expect(out.status).toBe(0);
    // a run of one repository ignores maxSessions
    expect(peak(out.spans)).toBe(2);
    expect(out.stderr).not.toContain('deliver.maxSessions');
  });

  it('runs two independent issues at once with parallel 2 and merges both one after the other', async () => {
    const out = await loop({ items: [item(41), item(42)], sessionMs: 400 }, { parallel: 2 });
    expect(out.status).toBe(0);
    const [a] = implementers(out.spans, 41);
    const [b] = implementers(out.spans, 42);
    expect(a && b && overlap(a, b)).toBe(true);
    expect(peak(out.spans)).toBe(2);
    expect(out.merges.map((m) => m.pull).sort()).toEqual([141, 142]);
    expect(out.results.map((r) => r.outcome)).toEqual(['merged', 'merged']);
    expect(out.log).toContain('parallel: up to 2 sessions at once');
    // the number of running sessions, as the displays read it
    const counts = out.events
      .filter((e) => e.type === 'deliver.sessions')
      .map((e) => (e as { deliver?: { running: number; limit: number } }).deliver);
    expect(counts).toContainEqual({ repo: 'fake/repo', running: 2, limit: 2 });
    expect(counts.at(-1)).toEqual({ repo: 'fake/repo', running: 0, limit: 2 });
    expect(out.events.at(-1)).toMatchObject({ type: 'run.finished', outcome: 'succeeded' });
    profile.expectRun(out.events as ProfileEvent[]);
  });

  it('starts a blocked issue after its blocker merged, beside an independent one', async () => {
    const out = await loop(
      { items: [item(52, [51]), item(51), item(53)], sessionMs: 300 },
      { parallel: 2 },
    );
    expect(out.status).toBe(0);
    const started = implementers(out.spans, 52)[0]!;
    expect(started.at).toBeGreaterThanOrEqual(implementers(out.spans, 51)[0]!.end);
    expect(out.log.indexOf('#52 start')).toBeGreaterThan(out.log.indexOf('#51 merged'));
    expect(out.merges.map((m) => m.pull)).toContain(152);
    expect(out.merges.map((m) => m.pull).indexOf(151)).toBeLessThan(
      out.merges.map((m) => m.pull).indexOf(152),
    );
  });

  it('counts the review sessions toward the limit', async () => {
    const out = await loop(
      { items: [item(61), item(62), item(63)], sessionMs: 250 },
      { parallel: 2 },
    );
    expect(out.status).toBe(0);
    expect(out.spans.filter((s) => s.review)).toHaveLength(3);
    expect(peak(out.spans)).toBe(2);
  });

  it('works one issue after the other with deliver.parallel 1, as before', async () => {
    config({ parallel: 1 });
    const out = await loop(
      { items: [item(71), item(72)], sessionMs: 150 },
      { parallel: 'default' },
    );
    expect(out.status).toBe(0);
    expect(peak(out.spans)).toBe(1);
    expect(out.spans.map((s) => [s.id, s.review])).toEqual([
      [71, false],
      [71, true],
      [72, false],
      [72, true],
    ]);
    expect(out.log).toContain('parallel: up to 1 sessions at once');
    expect(out.stderr).not.toContain('deliver.parallel');
  });

  it('starts no more issues than --max', async () => {
    const out = await loop({ items: [item(81), item(82)] }, { parallel: 2, args: ['--max', '1'] });
    expect(out.results.map((r) => r.issue)).toEqual([81]);
  });

  it('ends every running session on a stop and leaves both issues resumable', async () => {
    const out = await loop(
      { items: [item(91), item(92)], hangs: true },
      {
        parallel: 2,
        // both hanging sessions printed their first line: both run
        whenStdout: (stdout, stop) => {
          if (stdout.split('\n  working').length > 2) stop();
        },
      },
    );
    expect(out.status).toBe(130);
    expect(out.sessions.map((s) => s.id).sort()).toEqual([91, 92]);
    expect(out.results.map((r) => r.outcome)).toEqual(['stopped', 'stopped']);
    expect(out.merges).toEqual([]);
    // the label of a stopped item stays at its stage
    expect(out.stages.filter((s) => s.stage === null)).toEqual([]);
  });

  it('refuses --parallel below 1', async () => {
    const out = await loop({ items: [item(95)] }, { parallel: 0 });
    expect(out.status).toBe(64);
    expect(out.stderr).toContain('--parallel (deliver.parallel) needs a whole number from 1');
  });

  it('refuses --max-sessions below 1 for an Objective run', async () => {
    const out = await loop(
      { items: [item(96)] },
      { args: ['--objective', 'fake/repo#1', '--dry-run', '--max-sessions', '0'] },
    );
    expect(out.status).toBe(64);
    expect(out.stderr).toContain(
      '--max-sessions (deliver.maxSessions) needs a whole number from 1',
    );
  });

  it('ignores --max-sessions in a run of one repository', async () => {
    const out = await loop(
      { items: [item(97), item(98)], sessionMs: 400 },
      { parallel: 2, args: ['--max-sessions', '1'] },
    );
    expect(out.status).toBe(0);
    expect(peak(out.spans)).toBe(2);
  });
});

describe('deliver loop: a conflict at the merge gate', () => {
  it('goes through one repair session, reviews the new head and merges it', async () => {
    const conflict = { state: 'conflict', detail: 'conflicts with main' };
    const ready = { state: 'ready', reported: true, head: 'abc123' };
    const out = await loop({ items: [item(97)], gates: [conflict, conflict, ready] });
    expect(out.status).toBe(0);
    expect(out.log).toContain('#97 conflicts with main, one repair session');
    expect(out.log).toContain('#97 conflict repaired');
    expect(out.spans.map((s) => s.review)).toEqual([false, true, false, true]);
    expect(out.merges.map((m) => m.pull)).toEqual([197]);
  });
});
