import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { type State, setupObjective, twoRepos } from '../../helpers/objective-loop';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #607: the context file of a downstream repository is reused while the upstream PRs are the same, rewritten for a new one.
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const now = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');
const pr = (n: number) => ({
  number: n,
  html_url: `https://github.com/o/a/pull/${n}`,
  title: `feat: change ${n}`,
  merged_at: now(),
  labels: [],
});
const base = (prs: ReturnType<typeof pr>[]): Omit<State, 'checkouts'> => {
  const st = twoRepos();
  st.issues['o/a#10'].children = ['o/a#11'];
  delete st.issues['o/a#12'];
  st.issues['o/b#20'].body = 'Requires: o/a@M1 released';
  st.issues['o/a#11'].state = 'closed';
  st.milestones['o/a'][0].state = 'closed';
  st.prs = { 'o/a': prs };
  return st;
};

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 -Objective context file',
  () => {
    let dir = '';
    let worker: PwshWorker;
    beforeAll(() => {
      dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deliver-objective-ctx-')));
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(() => {
      worker.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('unchanged upstream PRs reuse the file without a diff stat read; a new PR rewrites it', async () => {
      const st = base([pr(7)]);
      const c = setupObjective(worker, path.join(dir, 'case-1'), st);
      const file = path.join(c.root, 'elsewhere', 'b', '.agents/deliver-loop/context.md');
      const detail = (n: number) =>
        c.gh
          .calls()
          .filter(
            (x) => x.args.join(' ').includes(`pulls/${n}`) && !x.args.join(' ').includes('state='),
          ).length;

      let r = await c.run(['-NoPreflight']);
      expect(r.stdout).toContain('context file written (1 PRs)');
      expect(detail(7)).toBe(1);
      const first = fs.readFileSync(file, 'utf8');

      c.save({ ...st, checkouts: c.load().checkouts });
      r = await c.run(['-NoPreflight']);
      expect(r.stdout).toContain('context file reused');
      expect(detail(7)).toBe(1);
      expect(fs.readFileSync(file, 'utf8')).toBe(first);

      const st2 = base([pr(7), pr(8)]);
      c.save({ ...st2, checkouts: c.load().checkouts });
      r = await c.run(['-NoPreflight']);
      expect(r.stdout).toContain('context file written (2 PRs)');
      expect(detail(7)).toBe(1);
      expect(detail(8)).toBe(1);
      expect(fs.readFileSync(file, 'utf8')).toContain('o/a#8 https://github.com/o/a/pull/8');
    });
  },
);
