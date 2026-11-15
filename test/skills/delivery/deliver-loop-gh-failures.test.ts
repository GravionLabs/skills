import { spawnSync } from 'child_process';
import * as path from 'path';
import { DeliverLoopFixture, pbi } from '../../helpers/deliver-loop-fixture';
import { lastLine, readJsonl } from '../../helpers/loop-run-files';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
// the retry waits of a failed gh call are cut to 0 seconds: no case sleeps
const NO_WAIT = { DELIVER_GH_RETRY_SECONDS: '0,0,0' };
const hhmmss = (d: Date) =>
  [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, '0')).join(':');

// #672: a failed gh call of the loop is retried (Get-Json); a rate limit waits until its reset; still failing: `failed`, exit 5.
describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 gh failures',
  () => {
    const fx = new DeliverLoopFixture(SCRIPT);
    beforeAll(() => fx.start());
    afterAll(() => fx.stop());

    it('a gh call that fails twice and then answers is retried: the PBI is delivered, exit 0', async () => {
      const gh = fx.setup({
        issues: { 61: pbi() },
        effect: 'close-first',
        ghFail: [{ match: 'issues/61', times: 2 }],
      });
      const r = await fx.run(gh, ['-Target', '61'], NO_WAIT);
      expect(r.stdout).toContain(
        'github: gh api repos/{owner}/{repo}/issues/61 failed, retry 1/3 in 0 s',
      );
      expect(r.stdout).toContain('retry 2/3 in 0 s');
      expect(r.stdout).not.toContain('retry 3/3');
      expect(r.stdout).toContain('loop result: done');
      expect(r.status).toBe(0);
    });

    it('a rate limit answer waits until the reset of gh api rate_limit, then goes on', async () => {
      const reset = Math.floor(Date.now() / 1000) - 5;
      const gh = fx.setup({
        issues: { 62: pbi() },
        effect: 'close-first',
        rateLimitReset: reset,
        ghFail: [
          {
            match: 'issues/62',
            times: 1,
            message: 'gh: API rate limit exceeded for user ID 1. (HTTP 403)',
          },
        ],
      });
      const r = await fx.run(gh, ['-Target', '62'], NO_WAIT);
      expect(r.stdout).toContain(
        `github: rate limit, waits until ${hhmmss(new Date(reset * 1000))}`,
      );
      expect(r.stdout).not.toContain('retry 1/3');
      expect(gh.calls().filter((c) => c.args[1] === 'rate_limit')).toHaveLength(1);
      expect(r.status).toBe(0);
    });

    it('a gh call that still fails after 3 retries ends the run failed: exit 5, the call on the last line', async () => {
      const gh = fx.setup({ issues: { 63: pbi() }, ghFail: [{ match: 'issues/63', times: 99 }] });
      const r = await fx.run(gh, ['-Target', '63'], NO_WAIT);
      expect(r.status).toBe(5);
      expect(fx.harnessCalls()).toEqual([]);
      expect(r.stdout).toContain('loop result: failed');
      expect(lastLine(r.stdout)).toContain(
        'failed: gh api repos/{owner}/{repo}/issues/63 failed after 3 retries: HTTP 502: Bad Gateway',
      );
      const finished = readJsonl(path.join(fx.cwd, '.agents/events')).filter(
        (e) => e.type === 'run.finished',
      );
      expect(finished.map((e) => e.deliver.result)).toEqual(['failed']);
    });
  },
);
