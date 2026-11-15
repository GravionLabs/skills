import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type State, setupObjective, twoRepos } from '../../helpers/objective-loop';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #648: a repository loop of -Objective that exits 3 (release/next missing) is reported as needs you (fixture test/helpers/objective-loop.ts).
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 -Objective exit 3',
  () => {
    let dir = '';
    let worker: PwshWorker;
    let seq = 0;
    beforeAll(() => {
      dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deliver-objective-exit3-')));
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(() => {
      worker.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const setup = (st: Omit<State, 'checkouts'>) =>
      setupObjective(worker, path.join(dir, `case-${++seq}`), st);

    it('a repository loop exiting 3 (release/next missing) ends gated with needs you: github-release cut (#648)', async () => {
      const c = setup(twoRepos());
      // a reachable origin without release/next makes the repository's own loop exit 3
      const bare = path.join(dir, `bare-${seq}`);
      spawnSync('git', ['init', '-q', '--bare', bare]);
      Object.assign(c.env, {
        GIT_CONFIG_COUNT: '1',
        GIT_CONFIG_KEY_0: `url.${bare}.insteadOf`,
        GIT_CONFIG_VALUE_0: 'https://github.com/o/a.git',
      });
      const r = await c.run(['-NoPreflight']);
      expect(r.stdout).toMatch(/round 1 results: o\/a release\/next missing\b/);
      expect(r.stdout).toContain('github-release cut in o/a');
      expect(r.stdout).toContain('objective result: gated (1 round(s))');
      expect(r.status).toBe(3);
      expect(c.harness()).toEqual([]);
    });
  },
);
