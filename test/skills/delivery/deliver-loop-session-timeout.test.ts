import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { DeliverLoopFixture, pbi } from '../../helpers/deliver-loop-fixture';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
// the waits after a harness failure are cut to 0 minutes: no case sleeps
const NO_WAIT = { DELIVER_HARNESS_RETRY_MINUTES: '0,0,0' };

// #672: a session that runs longer than deliver.sessionTimeoutMinutes is stopped with its process tree; one more session,
// a second timeout sets the PBI aside (own file: time budget).
describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 session timeout',
  () => {
    const fx = new DeliverLoopFixture(SCRIPT);
    beforeAll(() => fx.start());
    afterAll(() => fx.stop());
    const pbiOf = () => fx.harnessCalls().map((c) => c.split(' ')[2]);
    const timeout = (minutes: number) => {
      fs.mkdirSync(path.join(fx.cwd, '.agents'), { recursive: true });
      fs.writeFileSync(
        path.join(fx.cwd, '.agents/config.json'),
        JSON.stringify({ deliver: { sessionTimeoutMinutes: minutes } }),
      );
    };

    it('a session that hangs is stopped after deliver.sessionTimeoutMinutes and gets one more session', async () => {
      const gh = fx.setup({ issues: { 75: pbi() }, effect: 'close-first', hang: [1] });
      timeout(0.01);
      const r = await fx.run(gh, ['-Target', '75'], NO_WAIT);
      expect(pbiOf()).toEqual(['75', '75']);
      expect(r.stdout).toContain('#75 session timeout after 0.01 min: process tree stopped');
      expect(r.stdout).toContain('#75 one more session after the timeout');
      expect(r.stdout).toContain('loop result: done');
      expect(r.status).toBe(0);
    });

    it('a second timeout sets the PBI aside with the reason session timeout', async () => {
      const gh = fx.setup({ issues: { 76: pbi() }, effect: 'close-first', hang: [1, 2] });
      timeout(0.01);
      const r = await fx.run(gh, ['-Target', '76'], NO_WAIT);
      expect(pbiOf()).toEqual(['76', '76']);
      expect(r.stdout).toContain('#76 set aside: session timeout');
      expect(r.stdout).toContain('set aside #76: session timeout (no PR)');
      expect(r.status).toBe(2);
    });

    it('an invalid deliver.sessionTimeoutMinutes warns and uses 120', async () => {
      const gh = fx.setup({ issues: { 77: pbi() }, effect: 'close-first' });
      timeout(-1);
      const r = await fx.run(gh, ['-Target', '77'], NO_WAIT);
      expect(r.stdout).toContain(
        "deliver.sessionTimeoutMinutes '-1' is not a number above 0: 120 is used",
      );
      expect(r.status).toBe(0);
    });
  },
);
