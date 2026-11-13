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

    it('a repository loop ending max reached is labelled by its result record, not done (#575)', async () => {
      const st = twoRepos();
      st.issues['o/a#13'] = {};
      st.issues['o/a#10'].children = ['o/a#11', 'o/a#13', 'o/a#12'];
      const c = setup(st);
      const r = await c.run(['-NoPreflight', '-Max', '1']);
      expect(r.stdout).toMatch(/round 1 results: o\/a max reached\b/);
      expect(r.stdout).not.toMatch(/round 1 results: o\/a done/);
    });

    // Functions of ObjectiveLoop.ps1 (dot-sourced by the loop) in one throwaway process
    const ps = (body: string) => {
      const lib = path.resolve(
        __dirname,
        '../../../skills/delivery/deliver/scripts/ObjectiveLoop.ps1',
      );
      const r = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-Command',
          `function Write-Step($m, $c) { Write-Output $m }; . '${lib}'; ${body}`,
        ],
        { encoding: 'utf8' },
      );
      return r.stdout.trim().split('\n');
    };

    it('Get-RepoLoopLabel reads the result record of the newest run, ok (0) without one', () => {
      const co = path.join(dir, 'label');
      const run = path.join(co, '.agents/deliver-loop/20260101-000000');
      fs.mkdirSync(run, { recursive: true });
      fs.writeFileSync(path.join(co, '.agents/deliver-loop/latest.txt'), run);
      fs.writeFileSync(
        path.join(run, 'progress.jsonl'),
        '{"event":"start"}\n{"event":"result","result":"max reached","code":0}\n',
      );
      const none = path.join(dir, 'label-none');
      fs.mkdirSync(none, { recursive: true });
      const out = ps(
        `Get-RepoLoopLabel 0 '${co}'; Get-RepoLoopLabel 0 '${none}'; Get-RepoLoopLabel 2 '${co}'; Get-RepoLoopLabel 1 '${co}'`,
      );
      expect(out).toEqual(['max reached', 'ok (0)', 'blocked', 'no progress']);
    });

    it('Write-NeedsYou prints the acceptance-criteria gate while a repository is open', () => {
      const out = ps(
        `$s = '{"objective":{"repository":"o/telos","number":1,"url":"u"},"repos":[{"state":"waiting"}],"gates":[{"type":"acceptance-criteria","detail":"2 open","url":"https://x/1"},{"type":"mystery","detail":"d"}]}' | ConvertFrom-Json; Write-NeedsYou $s`,
      );
      expect(out).toEqual([
        'needs you:',
        '  1. check the acceptance criteria of o/telos#1 and close the objective: https://x/1',
        '  2. mystery d',
      ]);
    });
  },
);
