import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { marker, type State, setupObjective, twoRepos } from '../../helpers/objective-loop';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #543: Invoke-DeliverLoop.ps1 -Objective runs rounds over the ready repositories of an [Objective]. The fixture
// (test/helpers/objective-loop.ts) serves the GitHub state of several repositories from one state file; a fake claude
// closes the PBI of its prompt in the repository of its cwd. Each repository's loop is a real child pwsh process.
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 -Objective',
  () => {
    let dir = '';
    let worker: PwshWorker;
    let seq = 0;
    beforeAll(() => {
      dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deliver-objective-')));
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(() => {
      worker.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const setup = (st: Omit<State, 'checkouts'>) =>
      setupObjective(worker, path.join(dir, `case-${++seq}`), st);

    it('two repos, one waits for the rc of the other: round 1 delivers the ready repo, the end is gated; the same command resumes from GitHub', async () => {
      // #544: a dead marker of another host (heartbeat older than 30 minutes) is taken over in place
      const c = setup({
        ...twoRepos(),
        comments: { 'o/telos#1': [{ id: 7, body: marker('there', '2020-01-01T00:00:00Z') }] },
      });
      const r = await c.run([]);
      expect(r.stdout).toContain(
        'runner: here took over the dead marker of there (heartbeat 2020-01-01T00:00:00Z)',
      );
      expect(r.stdout).toContain(
        `round 1: o/a start deliver-loop -Target 10 in ${path.join(c.root, 'a')} (sibling)`,
      );
      expect(r.stdout).toContain('[o/a] preflight allowlist');
      expect(r.stdout).not.toMatch(/round \d+: o\/b/);
      expect(c.harness()).toEqual(['o/a /deliver 11 --unattended --max 1']);
      expect(r.stdout).toContain('o/b: 0/1 waiting(requires o/a@M1 rc)');
      expect(r.stdout).toContain('needs you:');
      expect(r.stdout).toContain(
        '1. RC test o/a@M1 rc (milestone open): https://github.com/o/a/issues/12',
      );
      expect(r.stdout).toContain('objective result: gated (1 round(s))');
      expect(r.status).toBe(3);

      // the RC is posted on GitHub: the same command starts o/b in its checkouts.json path and ends gated on the criteria
      const st = c.load();
      st.issues['o/a#12'].state = 'closed';
      c.save({ ...st, rcPosted: true });
      const again = await c.run(['-NoPreflight']);
      expect(again.stdout).toContain(
        `round 1: o/b start deliver-loop -Target 20 in ${path.join(c.root, 'elsewhere/b')} (checkouts.json)`,
      );
      expect(c.harness()).toHaveLength(2);
      expect(c.harness()[1]).toBe('o/b /deliver 21 --unattended --max 1');
      expect(again.stdout).toContain(
        '1. check the acceptance criteria of o/telos#1 and close the objective: https://github.com/o/telos/issues/1',
      );
      expect(again.status).toBe(3);
      // never closes the objective: the only writes are the runner marker, one comment replaced in place
      expect(c.load().issues['o/telos#1'].state ?? 'open').toBe('open');
      const writes = c.gh.calls().filter((x) => x.args[0] !== 'api' || x.args.includes('-X'));
      expect(writes.map((x) => x.args.slice(1, 4).join(' '))).toEqual([
        '-X PATCH repos/o/telos/issues/comments/7',
        '-X PATCH repos/o/telos/issues/comments/7',
      ]);
      expect(c.comments().map((x) => x.id)).toEqual([7]);
      expect(c.comments()[0].body).toMatch(
        /<!-- objective-runner: host=here since=\S+ heartbeat=\S+ -->/,
      );
    });

    it('-DryRun prints the repos with their targets and checkouts (sibling, checkouts.json, fresh clone) and starts nothing', async () => {
      const st = twoRepos();
      st.issues['o/b#20'].body = '';
      st.issues['o/telos#1'].children!.push('o/c#30');
      st.issues['o/c#30'] = { labels: ['feature'], children: ['o/c#31'] };
      st.issues['o/c#31'] = {};
      const c = setup(st);
      const r = await c.run(['-DryRun', '-Max', '2']);
      const clone = path.join(c.home, '.cache/deliver/checkouts/o/c');
      expect(r.stdout).toContain(
        `round 1: o/a would start deliver-loop -Target 10 -Max 2 in ${path.join(c.root, 'a')} (sibling)`,
      );
      expect(r.stdout).toContain(
        `round 1: o/b would start deliver-loop -Target 20 -Max 2 in ${path.join(c.root, 'elsewhere/b')} (checkouts.json)`,
      );
      expect(r.stdout).toContain(
        `round 1: o/c would start deliver-loop -Target 30 -Max 2 in ${clone} (clone, fresh clone)`,
      );
      expect(r.stdout).toContain('objective result: dry run');
      expect(r.status).toBe(0);
      expect(c.harness()).toEqual([]);
      expect(fs.existsSync(clone)).toBe(false);
      expect(r.stdout).not.toContain('preflight');
    });

    // the message goes to [Console]::Error, which the in-process worker does not capture: status only
    it.each([
      [['-Objective', 'o/telos#1', '-Target', '5']],
      [['-Target', '5', '-DryRun']],
      [['-Objective', 'telos-1']],
    ])('bad arguments %j exit 64', async (args) => {
      const r = await worker.run(args, { cwd: dir });
      expect(r.status).toBe(64);
    });
  },
);
