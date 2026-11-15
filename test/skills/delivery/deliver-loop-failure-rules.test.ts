import {
  isRateLimit,
  waitsFrom,
  withRetry,
} from '../../../skills/delivery/deliver/scripts/loop/state.ts';
import {
  classifySession,
  exitCodeFor,
  harnessFailureAction,
  sessionTimeoutMinutes,
  timeoutAction,
} from '../../../skills/delivery/deliver/scripts/loop/stop.ts';

// #672: the TypeScript loop's rules for harness and GitHub failures (the same as Invoke-DeliverLoop.ps1).
describe('loop failure rules', () => {
  it('failed exits 5', () => {
    expect(exitCodeFor('failed')).toBe(5);
  });

  it.each([
    [{ exitCode: 1, stepFinished: false, timedOut: false }, 'harness failure'],
    [{ exitCode: 1, stepFinished: true, timedOut: false }, 'ok'],
    [{ exitCode: 0, stepFinished: false, timedOut: false }, 'ok'],
    [{ exitCode: 137, stepFinished: false, timedOut: true }, 'timeout'],
  ] as const)('classifySession(%o) is %s', (end, verdict) => {
    expect(classifySession(end)).toBe(verdict);
  });

  it('retries after 5, then 15 minutes; the third failure in a row ends the run failed', () => {
    expect(harnessFailureAction(1, 1)).toEqual({ action: 'retry', waitMinutes: 5 });
    expect(harnessFailureAction(2, 1)).toEqual({ action: 'retry', waitMinutes: 15 });
    expect(harnessFailureAction(3, 2)).toEqual({
      action: 'fail',
      cause: 'the harness failed 3 times in a row (last exit 2)',
    });
  });

  it('a first timeout gives one more session, the second sets the PBI aside', () => {
    expect(timeoutAction(1)).toBe('retry');
    expect(timeoutAction(2)).toBe('set aside');
  });

  it.each([
    [{ deliver: { sessionTimeoutMinutes: 30 } }, 30],
    [{ deliver: { sessionTimeoutMinutes: 0 } }, 120],
    [{ deliver: { sessionTimeoutMinutes: '30' } }, 120],
    [{}, 120],
    [null, 120],
  ])('sessionTimeoutMinutes(%o) is %d', (config, minutes) => {
    expect(sessionTimeoutMinutes(config)).toBe(minutes);
  });

  it('reads the waits of an environment variable, else the default', () => {
    expect(waitsFrom('0,0,0', [5, 30, 120])).toEqual([0, 0, 0]);
    expect(waitsFrom(undefined, [5, 30, 120])).toEqual([5, 30, 120]);
    expect(waitsFrom('x', [5])).toEqual([5]);
  });

  it.each([
    ['gh: API rate limit exceeded for user ID 1. (HTTP 403)', true],
    ['HTTP 429: Too Many Requests', true],
    ['HTTP 502: Bad Gateway', false],
  ])('isRateLimit(%s) is %s', (message, expected) => {
    expect(isRateLimit(message)).toBe(expected);
  });

  describe('withRetry', () => {
    const fails = (n: number, message = 'HTTP 502: Bad Gateway') => {
      let calls = 0;
      const call = async () => {
        calls++;
        if (calls <= n) throw new Error(message);
        return 'ok';
      };
      return { call, count: () => calls };
    };

    it('a call that recovers: retried after 5 and 30 s, then its answer', async () => {
      const slept: number[] = [];
      const steps: string[] = [];
      const f = fails(2);
      const out = await withRetry('gh api x', f.call, {
        sleep: async (ms) => void slept.push(ms),
        onStep: (l) => steps.push(l),
      });
      expect(out).toBe('ok');
      expect(slept).toEqual([5000, 30000]);
      expect(steps).toEqual([
        'github: gh api x failed, retry 1/3 in 5 s',
        'github: gh api x failed, retry 2/3 in 30 s',
      ]);
    });

    it('a rate limit waits until the reset of the exhausted limit', async () => {
      const slept: number[] = [];
      const steps: string[] = [];
      const reset = new Date(2026, 10, 15, 14, 30, 0).getTime() / 1000;
      const f = fails(1, 'API rate limit exceeded (HTTP 403)');
      await withRetry('gh api x', f.call, {
        sleep: async (ms) => void slept.push(ms),
        onStep: (l) => steps.push(l),
        now: () => (reset - 60) * 1000,
        rateLimitReset: async () => reset,
      });
      expect(steps).toEqual(['github: rate limit, waits until 14:30:00']);
      expect(slept).toEqual([61000]);
    });

    it('a call that still fails after 3 retries throws with its cause', async () => {
      const f = fails(99);
      await expect(
        withRetry('gh api x', f.call, { sleep: async () => {}, onStep: () => {} }),
      ).rejects.toThrow('gh api x failed after 3 retries: HTTP 502: Bad Gateway');
      expect(f.count()).toBe(4);
    });
  });
});
