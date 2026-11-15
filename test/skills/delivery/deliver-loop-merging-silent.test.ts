import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';
import { SCRIPTS, pr, run, setup, started } from '../../helpers/loop-merging';

// #605: an open PBI whose PR merges by auto-merge is merging, not no progress (own file: time budget)
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

    // #605: the session reports nothing, the issue is still open; its PR is in auto-merge or just merged -> merging, not no progress
    it.each([
      ['auto-merge', pr('green')],
      [
        'merged',
        `{ number: 55, state: 'closed', merged_at: '2026-11-01T10:00:00Z', head: { ref: 'fix/10-a', sha: 'green' }, auto_merge: null }`,
      ],
    ])('an open PBI whose PR is %s counts as merging, not no progress', async (name, prJson) => {
      const s = setup(root, `silent-${name}`, [10], {}, `() => [[${prJson}]]`);
      fs.writeFileSync(path.join(s.cwd, 'harness.js'), '');
      const r = await run(loop, s, '1');
      expect(r.stdout).not.toContain('no progress');
      expect(r.stdout).toContain('loop result: done');
      expect(r.status).toBe(0);
    });

    it('an open PBI without a PR is set aside (blocked)', async () => {
      const s = setup(root, 'silent-nopr', [10], {}, '() => [[]]');
      fs.writeFileSync(path.join(s.cwd, 'harness.js'), '');
      const r = await run(loop, s, '1');
      expect(r.stdout).toContain('#10 set aside: the session ended without an outcome');
      expect(r.stdout).toContain('set aside #10: the session ended without an outcome (no PR)');
      expect(r.stdout).not.toContain('no progress:');
      expect(r.stdout).toContain('loop result: blocked');
      expect(r.status).toBe(2);
    });
  },
);
