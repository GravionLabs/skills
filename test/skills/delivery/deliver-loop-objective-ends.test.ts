import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type State, setupObjective, twoRepos } from '../../helpers/objective-loop';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #543: the results no progress, blocked and done of Invoke-DeliverLoop.ps1 -Objective (fixture test/helpers/objective-loop.ts;
// split off deliver-loop-objective.test.ts for the time budget).
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 -Objective results',
  () => {
    let dir = '';
    let worker: PwshWorker;
    let seq = 0;
    beforeAll(() => {
      dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deliver-objective-ends-')));
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(() => {
      worker.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const setup = (st: Omit<State, 'checkouts'>) =>
      setupObjective(worker, path.join(dir, `case-${++seq}`), st);

    it('a round without change ends no progress (exit 1)', async () => {
      const c = setup(twoRepos());
      c.save({ ...c.load(), noEffect: true } as State);
      const r = await c.run(['-NoPreflight']);
      expect(c.harness()).toHaveLength(1);
      expect(r.stdout).toContain(
        'no progress: the objective state did not change in the last round',
      );
      expect(r.stdout).toContain('objective result: no progress (1 round(s))');
      expect(r.status).toBe(1);
    });

    it.each([
      ['blocked', 2, (s: Omit<State, 'checkouts'>) => (s.issues['o/a#11'].blockers = ['o/b#21'])],
      ['done', 0, (s: Omit<State, 'checkouts'>) => (s.issues['o/telos#1'].state = 'closed')],
    ])('ends %s (exit %i) without starting a repository', async (result, code, edit) => {
      const st = twoRepos();
      edit(st);
      const c = setup(st);
      const r = await c.run(['-NoPreflight']);
      expect(r.stdout).toContain(`objective result: ${result} (0 round(s))`);
      expect(r.status).toBe(code);
      expect(c.harness()).toEqual([]);
    });
  },
);
