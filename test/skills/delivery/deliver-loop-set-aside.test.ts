import { spawnSync } from 'child_process';
import * as path from 'path';
import { DeliverLoopFixture, pbi } from '../../helpers/deliver-loop-fixture';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// #655: a blocked, paused or outcome-less PBI is set aside for the rest of the run (own file: time budget).
describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 set aside',
  () => {
    const fx = new DeliverLoopFixture(SCRIPT);
    beforeAll(() => fx.start());
    afterAll(() => fx.stop());

    it('the first PBI is held, two ready PBIs follow: both are delivered, the run ends blocked (exit 2) and names the held one', async () => {
      const gh = fx.setup({
        issues: { 41: pbi(), 42: pbi(), 43: pbi() },
        milestones: { M8: [41, 42, 43] },
        effect: 'hold-then-close',
      });
      const r = await fx.run(gh, ['-Milestone', 'M8']);
      expect(r.status).toBe(2);
      expect(fx.harnessCalls().map((c) => c.split(' ')[2])).toEqual(['41', '42', '43']);
      expect(r.stdout).toContain('#41 set aside: ');
      expect(r.stdout).toMatch(/set aside #41: .* \(no PR\)/);
      expect(r.stdout).toContain('loop result: blocked');
      expect(r.stdout).not.toContain('no progress');
    });

    it('a PBI without an outcome is selected once, not again, in target mode', async () => {
      const gh = fx.setup({ issues: { 51: pbi(), 52: pbi() }, effect: 'none' });
      const r = await fx.run(gh, ['-Target', '51,52']);
      expect(fx.harnessCalls().map((c) => c.split(' ')[2])).toEqual(['51', '52']);
      expect(r.status).toBe(2);
      expect(r.stdout).toContain('#51 set aside: the session ended without an outcome');
      expect(r.stdout).toContain('#52 set aside: the session ended without an outcome');
    });
  },
);
