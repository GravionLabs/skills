import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeGh } from '../../helpers/fake-gh';

const GITHUB = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/tracker/github.mts',
);

// #682: a rate limit in the middle of a run waits (primary: until the reset, secondary: 60/120/300 s) instead of failing.
// DELIVER_TICK_MS shortens a second to 5 ms. Scenario: $dir/scenario.json = { failures: n, exhausted: bool }, the
// first n calls of `milestones` fail with a rate limit.
const handler = `(call, ctx) => {
  const fs = require('fs');
  const sc = JSON.parse(fs.readFileSync(process.env.SCENARIO, 'utf8'));
  const a = call.args;
  if (a[0] === 'repo') return { rest: 'o/r' };
  if (a[0] === 'api' && a[1] === 'rate_limit') {
    const now = Math.floor(Date.now() / 1000);
    return { rest: { resources: { core: { remaining: sc.exhausted ? 0 : 4000, reset: now + 3 } } } };
  }
  if (ctx.count('m') <= sc.failures) throw new Error('gh: API rate limit exceeded for user (HTTP 403)');
  return { rest: [[{ number: 1, title: 'M1', html_url: 'u' }]] };
}`;

describe('github tracker rate-limit wait', () => {
  let dir: string;
  let stopFile: string;
  let tracker: any;
  const saved = { ...process.env };
  const setup = async (failures: number, exhausted: boolean, extra: object = {}) => {
    writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify({ failures, exhausted }));
    const fake = createFakeGh(dir, handler);
    process.env = {
      ...fake.env(saved),
      SCENARIO: path.join(dir, 'scenario.json'),
      DELIVER_TICK_MS: '5',
    };
    const mod = await import(GITHUB);
    const logs: string[] = [];
    const stops: number[] = [];
    tracker = mod.create({
      cwd: dir,
      base: 'main',
      selection: { milestone: 'M1' },
      trustAuthors: false,
      stopFile,
      onStop: () => stops.push(1),
      onExhausted: () => stops.push(2),
      log: (t: string) => logs.push(t),
      ...extra,
    });
    return { fake, logs, stops };
  };
  const fetchMilestone = () => tracker.items();
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'rate-limit-'));
    mkdirSync(path.join(dir, 'run'));
    stopFile = path.join(dir, 'run', 'stop');
  });
  afterEach(() => {
    process.env = saved;
    vi.restoreAllMocks();
  });

  it('several primary windows in a row recover; a success resets the counter', async () => {
    const { logs } = await setup(3, true);
    expect(() => fetchMilestone()).not.toThrow(/rate limit/);
    expect(logs).toHaveLength(3);
    expect(logs.every((l) => l.includes('primary'))).toBe(true);
    expect(logs[0]).toMatch(/waits [1-4] s \(1 of 3\)/);
    // a success reset the counter: three more windows are waited out again
    writeFileSync(path.join(dir, 'count-m'), '0');
    writeFileSync(
      path.join(dir, 'scenario.json'),
      JSON.stringify({ failures: 3, exhausted: true }),
    );
    expect(() => tracker.items()).not.toThrow(/rate limit/);
  });

  it('a secondary limit waits 60, 120, 300 s', async () => {
    const { logs } = await setup(3, false);
    try {
      fetchMilestone();
    } catch (error) {
      expect(String(error)).not.toMatch(/rate limit/);
    }
    expect(logs.map((l) => l.match(/waits (\d+) s/)?.[1])).toEqual(['60', '120', '300']);
    expect(logs[0]).toContain('secondary');
  }, 20_000);

  it('the fourth rate-limit error in a row is thrown', async () => {
    const { logs, stops } = await setup(99, true);
    expect(() => fetchMilestone()).toThrow(/rate limit/i);
    expect(logs).toHaveLength(3);
    expect(stops).toEqual([2]);
  });

  it('a stop during a wait ends it and tells the loop', async () => {
    const { stops } = await setup(1, false);
    writeFileSync(stopFile, '');
    expect(() => fetchMilestone()).toThrow(/stopped during a rate-limit wait/);
    expect(stops).toHaveLength(1);
  });
});
