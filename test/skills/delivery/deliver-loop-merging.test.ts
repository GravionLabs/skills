import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';
import { SCRIPTS, pr, run, setup, started } from '../../helpers/loop-merging';

// #481: the loop waits for the merge of a `merging` blocker (own file: time budget)
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

    it('a PBI whose blocker is merging waits (waiting, then merged) instead of ending blocked', async () => {
      // poll 1: PR still waiting (green); poll 2: PR gone and issue 10 closed -> 11 is no longer blocked
      const s = setup(
        root,
        'wait',
        [10, 11],
        { 11: 10 },
        `(n, mark) => { if (n === 1) return [[${pr('green')}]]; mark('closed10'); return [[]]; }`,
      );
      const r = await run(loop, s, '2');
      expect(r.stdout).toContain('#11 select: waits for merge of #10');
      expect(started(s.cwd)).toEqual([10, 11]);
    });
  },
);
