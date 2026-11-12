import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { type State, setupObjective, twoRepos } from '../../helpers/objective-loop';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #545: the two rules between rounds of Invoke-DeliverLoop.ps1 -Objective: contract-change pauses the downstream children,
// a finished milestone with a waiting rc edge runs deliver step 9 in the upstream repository. Fixture: test/helpers/objective-loop.ts.
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 -Objective rules',
  () => {
    let dir = '';
    let worker: PwshWorker;
    let seq = 0;
    const setup = (st: Omit<State, 'checkouts'>) =>
      setupObjective(worker, path.join(dir, `case-${++seq}`), st);
    beforeAll(() => {
      dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deliver-objective-rules-')));
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(() => {
      worker.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('rule 2: a finished milestone with a waiting rc edge runs step 9 in the upstream repo once, then the downstream repo starts', async () => {
      const c = setup(twoRepos());
      const r = await c.run(['-NoPreflight']);
      expect(c.harness()).toEqual([
        'o/a /deliver 11 --unattended --max 1',
        'o/a /deliver --milestone M1 --unattended --max 1',
        'o/b /deliver 21 --unattended --max 1',
      ]);
      expect(r.stdout).toContain(
        `run rc trigger: o/a /deliver --milestone M1 --unattended --max 1 in ${path.join(c.root, 'a')} (sibling)`,
      );
      expect(r.stdout).toContain('release PR stays yours');
      expect(r.status).toBe(3);
      // the only writes are the runner marker on the objective: nothing on o/a or o/b
      expect(
        c.gh.calls().filter((x) => x.args.includes('-X') && !x.args.join(' ').includes('o/telos')),
      ).toEqual([]);
    });

    it('rule 2: an open PBI in the milestone keeps the trigger back', async () => {
      const st = twoRepos();
      st.issues['o/a#10'].children = ['o/a#11', 'o/a#12', 'o/a#13'];
      st.issues['o/a#13'] = { labels: ['pbi', 'needs-decision'] };
      const c = setup(st);
      const r = await c.run(['-NoPreflight']);
      expect(c.harness()).toEqual(['o/a /deliver 11 --unattended --max 1']);
      expect(r.stdout).not.toContain('rc trigger');
    });

    it('#546: the downstream repo gets a context file with the upstream PRs and its loop passes it as --context', async () => {
      const st = twoRepos();
      st.issues['o/a#10'].children = ['o/a#11'];
      delete st.issues['o/a#12'];
      st.issues['o/b#20'].body = 'Requires: o/a@M1 released';
      st.issues['o/a#11'].state = 'closed';
      st.milestones['o/a'][0].state = 'closed';
      st.prs = {
        'o/a': [
          {
            number: 7,
            html_url: 'https://github.com/o/a/pull/7',
            title: 'feat: new field',
            merged_at: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
            labels: [],
          },
        ],
      };
      const c = setup(st);
      await c.run(['-NoPreflight']);
      const file = path.join(c.root, 'elsewhere', 'b', '.agents/deliver-loop/context.md');
      expect(fs.readFileSync(file, 'utf8')).toContain(
        'o/a#7 https://github.com/o/a/pull/7 feat: new field',
      );
      expect(c.harness().find((x) => x.startsWith('o/b '))).toContain('--context');
    });

    it('rule 2 -DryRun names the trigger and runs nothing', async () => {
      const st = twoRepos();
      st.issues['o/a#11'].state = 'closed';
      const c = setup(st);
      const r = await c.run(['-DryRun']);
      expect(r.stdout).toContain('would run rc trigger: o/a /deliver --milestone M1');
      expect(c.harness()).toEqual([]);
    });

    it('rule 1: a merged contract-change PBI pauses the Requires-downstream child with needs-refinement and a PR comment', async () => {
      const st = twoRepos();
      st.issues['o/a#10'].children = ['o/a#11'];
      delete st.issues['o/a#12'];
      st.issues['o/b#20'].body = 'Requires: o/a@M1 released';
      const c = setup({ ...st, contractPr: true });
      const r = await c.run(['-NoPreflight']);
      const b = c.load().issues['o/b#21'];
      expect(b.labels).toEqual(['pbi', 'needs-refinement']);
      const note = c.load().comments?.['o/b#21'] ?? [];
      expect(note).toHaveLength(1);
      expect(note[0].body).toContain('https://github.com/o/a/pull/111');
      expect(r.stdout).toContain(
        'paused o/b#21 (needs-refinement): contract-change https://github.com/o/a/pull/111',
      );
      expect(c.harness()).toEqual(['o/a /deliver 11 --unattended --max 1']);
    });

    it('rule 1: the blocked-by child that became ready is paused before its repository starts', async () => {
      const st = twoRepos();
      st.issues['o/a#10'].children = ['o/a#11'];
      delete st.issues['o/a#12'];
      st.issues['o/b#20'].body = '';
      st.issues['o/b#21'].blockers = ['o/a#11'];
      const c = setup({ ...st, contractPr: true });
      const r = await c.run(['-NoPreflight']);
      expect(c.load().issues['o/b#21'].labels).toEqual(['pbi', 'needs-refinement']);
      expect(c.harness()).toEqual(['o/a /deliver 11 --unattended --max 1']);
      expect(r.status).toBe(2);
    });
  },
);
