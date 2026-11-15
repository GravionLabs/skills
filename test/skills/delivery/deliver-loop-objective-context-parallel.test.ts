import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { type State, setupObjective, twoRepos } from '../../helpers/objective-loop';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #607: the context file of a downstream repository is generated in the parallel pre-step with deliver.parallel > 1.
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
  'Invoke-DeliverLoop.ps1 -Objective context file (deliver.parallel 2)',
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

    it('deliver.parallel 2: the context file is written before the loop starts and passed as --context', async () => {
      const c = setupObjective(worker, path.join(dir, 'case-1'), base([pr(7)]));
      fs.mkdirSync(path.join(c.root, 'telos/.agents'), { recursive: true });
      fs.writeFileSync(
        path.join(c.root, 'telos/.agents/config.json'),
        JSON.stringify({ deliver: { parallel: 2 } }),
      );
      const r = await c.run(['-NoPreflight']);
      expect(r.stdout).toContain('[o/b] context file written (1 PRs)');
      const file = path.join(c.root, 'elsewhere', 'b', '.agents/deliver-loop/context.md');
      expect(fs.readFileSync(file, 'utf8')).toContain(
        'o/a#7 https://github.com/o/a/pull/7 feat: change 7',
      );
      expect(c.harness().find((x) => x.startsWith('o/b '))).toContain('--context');
    });
  },
);
