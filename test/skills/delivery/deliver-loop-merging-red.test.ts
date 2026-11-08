import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';
import { SCRIPTS, pr, run, setup, started } from '../../helpers/loop-merging';

// #481: a merging PR that went red by this change is selected first (own file: time budget)
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 merging PRs (#481)',
  () => {
    let root: string;
    let loop: PwshWorker;
    beforeAll(() => {
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loop-merging-')));
      loop = new PwshWorker(path.join(SCRIPTS, 'Invoke-DeliverLoop.ps1'));
    });
    afterAll(() => {
      loop.close();
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('a merging PR that went red by this change is selected first while another PBI is ready', async () => {
      // 5 is blocked by 4 until the harness has run once: after iteration 1 both 5 and 10 are ready, 10 (red-change) goes first
      const s = setup(root, 'red', [5, 10], { 5: 4 }, `() => [[${pr('red')}]]`);
      const r = await run(loop, s, '2');
      expect(r.stdout).toContain('#10 select: leaves merging (red-change: red: test)');
      expect(started(s.cwd)).toEqual([10, 10]);
    });
  },
);
