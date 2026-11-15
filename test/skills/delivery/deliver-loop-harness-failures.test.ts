import { spawnSync } from 'child_process';
import * as path from 'path';
import { DeliverLoopFixture, pbi } from '../../helpers/deliver-loop-fixture';
import { lastLine, readJsonl } from '../../helpers/loop-run-files';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
// the waits after a harness failure are cut to 0 minutes: no case sleeps
const NO_WAIT = { DELIVER_HARNESS_RETRY_MINUTES: '0,0,0' };

// #672: a harness failure (exit other than 0, no step.finished) or a session timeout does not count against the PBI.
describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 harness failures',
  () => {
    const fx = new DeliverLoopFixture(SCRIPT);
    beforeAll(() => fx.start());
    afterAll(() => fx.stop());
    const pbiOf = () => fx.harnessCalls().map((c) => c.split(' ')[2]);

    it('two harness failures, then the same PBI is delivered: not set aside, exit 0', async () => {
      const gh = fx.setup({ issues: { 71: pbi() }, effect: 'close-first', exits: [1, 1] });
      const r = await fx.run(gh, ['-Target', '71'], NO_WAIT);
      expect(pbiOf()).toEqual(['71', '71', '71']);
      expect(r.stdout.match(/harness failed \(exit 1\), retry in 0 min/g)).toHaveLength(2);
      expect(r.stdout).toContain('loop result: done (1 iteration(s), 0 PBI(s) open)');
      expect(r.stdout).not.toContain('set aside');
      expect(r.status).toBe(0);
    });

    it('three harness failures in a row end the run failed: exit 5, run.finished failed, the cause on the last line', async () => {
      const gh = fx.setup({
        issues: { 72: pbi(), 73: pbi() },
        effect: 'close-first',
        exits: [2, 2, 2],
      });
      const r = await fx.run(gh, ['-Target', '72,73'], NO_WAIT);
      expect(r.status).toBe(5);
      expect(pbiOf()).toEqual(['72', '72', '72']);
      expect(r.stdout).toContain('loop result: failed');
      expect(lastLine(r.stdout)).toMatch(
        /failed: the harness failed 3 times in a row \(last: claude exit 2 on #72\)$/,
      );
      const finished = readJsonl(path.join(fx.cwd, '.agents/events')).filter(
        (e) => e.type === 'run.finished',
      );
      expect(finished.map((e) => [e.deliver.result, e.outcome, e.tone])).toEqual([
        ['failed', 'failed', 'danger'],
      ]);
      const runDir = fx.read('.agents/deliver-loop/latest.txt').trim();
      const result = readJsonl(runDir).find((p) => p.event === 'result');
      expect(result).toMatchObject({ result: 'failed', code: 5 });
    });

    it('a session that exits other than 0 after a step.finished is no harness failure: the PBI is set aside', async () => {
      const gh = fx.setup({
        issues: { 74: pbi() },
        exits: [1],
        events: [
          ['-Type', 'step.finished', '-Issue', '74', '-Step', 'implement', '-Result', 'started'],
        ],
      });
      const r = await fx.run(gh, ['-Target', '74'], NO_WAIT);
      expect(pbiOf()).toEqual(['74']);
      expect(r.stdout).toContain('#74 set aside: the session ended without an outcome');
      expect(r.stdout).not.toContain('harness failed');
      expect(r.status).toBe(2);
    });
  },
);
