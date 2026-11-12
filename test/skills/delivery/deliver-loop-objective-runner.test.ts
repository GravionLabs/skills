import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { marker, type State, setupObjective, twoRepos } from '../../helpers/objective-loop';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #544: the runner marker of Invoke-DeliverLoop.ps1 -Objective (ObjectiveRunner.ps1). At most one runner per objective:
// a foreign live marker hands over at the start; a takeover during a round lets the running PBI finish and hands over at
// the round boundary; a release during a round ends the round, posts the status and deletes the marker.
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, 'Z');

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 -Objective runner marker',
  () => {
    let dir = '';
    let worker: PwshWorker;
    let seq = 0;
    beforeAll(() => {
      dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deliver-objective-runner-')));
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(() => {
      worker.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const setup = (st: Omit<State, 'checkouts'>) =>
      setupObjective(worker, path.join(dir, `case-${++seq}`), st, {
        DELIVER_OBJECTIVE_HEARTBEAT_SECONDS: '1',
      });
    // o/a gets a second ready PBI (13): a handover must let 11 finish and never start 13
    const twoPbis = () => {
      const st = twoRepos();
      st.issues['o/a#10'].children!.push('o/a#13');
      st.issues['o/a#13'] = {};
      return st;
    };
    const writes = (c: ReturnType<typeof setup>) =>
      c.gh.calls().filter((x) => x.args.includes('-X'));

    it('a live marker of another host: handed over (exit 4) before any repository, nothing written', async () => {
      const live = marker('there', iso(new Date(Date.now() - 5 * 60_000)));
      const c = setup({ ...twoRepos(), comments: { 'o/telos#1': [{ id: 7, body: live }] } });
      const r = await c.run(['-NoPreflight']);
      expect(r.stdout).toContain('runner: o/telos#1 runs on there');
      expect(r.stdout).toContain('objective result: handed over (0 round(s))');
      expect(r.status).toBe(4);
      expect(c.harness()).toEqual([]);
      expect(writes(c)).toEqual([]);
      expect(c.comments()).toEqual([{ id: 7, body: live }]);
    });

    it('a takeover during a round: the running PBI finishes, the next is not started, handed over at the boundary', async () => {
      const c = setup({ ...twoPbis(), effect: 'takeover' });
      const r = await c.run(['-NoPreflight']);
      expect(c.harness()).toEqual(['o/a /deliver 11 --unattended --max 1']);
      expect(r.stdout).toContain('runner: o/telos#1 was taken over by there: handed over');
      expect(r.stdout).not.toMatch(/round \d+: o\/b/);
      expect(r.stdout).toContain('objective result: handed over (1 round(s))');
      expect(r.status).toBe(4);
      expect(c.load().issues['o/a#13'].state ?? 'open').toBe('open');
      expect(c.comments()).toHaveLength(1);
      expect(c.comments()[0].body).toContain('objective-runner: host=there');
    });

    it('a release during a round: heartbeat refreshed meanwhile, round ended, status comment posted, marker deleted', async () => {
      const c = setup({ ...twoPbis(), effect: 'release' });
      const r = await c.run(['-NoPreflight']);
      expect(fs.readFileSync(path.join(c.root, 'beat-changed'), 'utf8')).toBe('true');
      expect(c.harness()).toEqual(['o/a /deliver 11 --unattended --max 1']);
      expect(r.stdout).toContain('runner: release of o/telos#1 requested');
      expect(r.stdout).toContain('runner: status comment posted');
      expect(r.stdout).toContain('runner: runner marker released');
      expect(r.stdout).toContain('objective result: released (1 round(s))');
      expect(r.status).toBe(0);
      const left = c.comments();
      expect(left).toHaveLength(1);
      expect(left[0].body).toContain('Runner `here` released this objective');
      expect(left[0].body).toContain('Objective o/telos#1');
      expect(left[0].body).not.toContain('objective-runner:');
      expect(
        fs.existsSync(path.join(c.home, '.cache/deliver/objectives/o/telos/1/running.json')),
      ).toBe(false);
    });
  },
);
