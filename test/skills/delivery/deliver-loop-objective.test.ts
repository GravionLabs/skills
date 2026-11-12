import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #543: Invoke-DeliverLoop.ps1 -Objective runs rounds over the ready repositories of an [Objective]. A fake gh serves the
// GitHub state of several repositories from one state file (`{owner}/{repo}` from the checkout the call runs in); a fake
// claude closes the PBI of its prompt in the repository of its cwd. Each repository's loop is a real child pwsh process.
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

type Iss = {
  title?: string;
  state?: 'open' | 'closed';
  labels?: string[];
  body?: string;
  children?: string[];
  blockers?: string[];
};
type State = {
  issues: Record<string, Iss>;
  milestones: Record<string, { number: number; title: string; state: string }[]>;
  rcPosted: boolean;
  checkouts: Record<string, string>;
};

const handler = (stateFile: string) => `(call) => {
  const fs = require('fs'); const cp = require('child_process');
  const s = JSON.parse(fs.readFileSync(${JSON.stringify(stateFile)}, 'utf8'));
  const a = call.args;
  if (a.some((x) => ['-X', '--method', '-f', '-F', '--field', '--raw-field', '--input'].includes(x))) throw new Error('write: ' + a.join(' '));
  if (a[0] === 'repo' && a[1] === 'clone') {
    cp.execSync('git init -q ' + JSON.stringify(a[3]) + ' && git -C ' + JSON.stringify(a[3]) + ' remote add origin https://github.com/' + a[2] + '.git');
    s.checkouts[fs.realpathSync(a[3])] = a[2]; fs.writeFileSync(${JSON.stringify(stateFile)}, JSON.stringify(s));
    return { rest: '' };
  }
  if (a[0] !== 'api') throw new Error('unexpected gh ' + a.join(' '));
  const here = s.checkouts[fs.realpathSync(process.cwd())];
  const p = a[1].replace('{owner}/{repo}', here || 'unknown/unknown');
  const bare = p.split('?')[0];
  const issue = (key) => {
    const i = s.issues[key]; if (!i) throw new Error('404 ' + key);
    const [repo, nr] = key.split('#');
    return { number: Number(nr), title: i.title || 'T' + nr, state: i.state || 'open', body: i.body || '',
      labels: (i.labels || ['pbi']).map((name) => ({ name })), repository_url: 'https://api.github.com/repos/' + repo,
      issue_dependencies_summary: { blocked_by: (i.blockers || []).length } };
  };
  let v; let m;
  if ((m = /^repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)$/.exec(bare))) v = issue(m[1] + '#' + m[2]);
  else if ((m = /^repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)\\/sub_issues$/.exec(bare))) v = (s.issues[m[1] + '#' + m[2]].children || []).map(issue);
  else if ((m = /^repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)\\/dependencies\\/blocked_by$/.exec(bare))) v = (s.issues[m[1] + '#' + m[2]].blockers || []).map(issue);
  else if ((m = /^repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)\\/comments$/.exec(bare))) v = s.rcPosted ? [{ body: '<!-- release-test-rc --> RC 1.0.0-rc.1' }] : [];
  else if ((m = /^repos\\/([^/]+\\/[^/]+)\\/milestones$/.exec(bare))) v = s.milestones[m[1]] || [];
  else if ((m = /^repos\\/([^/]+\\/[^/]+)\\/issues$/.exec(bare))) v = Object.keys(s.issues).filter((k) => k.startsWith(m[1] + '#') && (s.issues[k].labels || []).includes('release-test')).map(issue);
  else if (/^repos\\/[^/]+\\/[^/]+\\/pulls$/.test(bare)) v = [];
  else if (/^repos\\/[^/]+\\/[^/]+$/.test(bare)) v = { default_branch: 'main' };
  else throw new Error('unexpected gh ' + a.join(' '));
  return { rest: a.includes('--paginate') ? [v] : v };
}`;

// objective o/telos#1 with Features o/a#10 (PBI 11) and o/b#20 (PBI 21); o/b requires an RC of o/a@M1
const twoRepos = (): Omit<State, 'checkouts'> => ({
  issues: {
    'o/telos#1': {
      title: '[Objective] Two',
      labels: ['objective'],
      body: '## Acceptance Criteria\n- [ ] works',
      children: ['o/a#10', 'o/b#20'],
    },
    'o/a#10': { labels: ['feature'], children: ['o/a#11', 'o/a#12'] },
    'o/a#11': {},
    'o/a#12': { labels: ['pbi', 'release-test'], title: '[PBI] RC test M1' },
    'o/b#20': { labels: ['feature'], body: 'Requires: o/a@M1 rc', children: ['o/b#21'] },
    'o/b#21': {},
  },
  milestones: { 'o/a': [{ number: 1, title: 'M1', state: 'open' }] },
  rcPosted: false,
});

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

    const gitRepo = (p: string, repo: string) => {
      fs.mkdirSync(p, { recursive: true });
      spawnSync('git', ['init', '-q', p]);
      spawnSync('git', ['-C', p, 'remote', 'add', 'origin', `https://github.com/${repo}.git`]);
    };

    // telos and a as siblings, b through ~/.config/deliver/checkouts.json, every other repo without a checkout
    function setup(st: Omit<State, 'checkouts'>) {
      const root = path.join(dir, `case-${++seq}`);
      const home = path.join(root, 'home');
      const co: Record<string, string> = {
        [path.join(root, 'telos')]: 'o/telos',
        [path.join(root, 'a')]: 'o/a',
        [path.join(root, 'elsewhere/b')]: 'o/b',
      };
      for (const [p, repo] of Object.entries(co)) gitRepo(p, repo);
      fs.mkdirSync(path.join(home, '.config/deliver'), { recursive: true });
      fs.writeFileSync(
        path.join(home, '.config/deliver/checkouts.json'),
        JSON.stringify({ 'o/b': path.join(root, 'elsewhere/b') }),
      );
      const stateFile = path.join(root, 'state.json');
      const save = (s: State) => fs.writeFileSync(stateFile, JSON.stringify(s));
      const load = (): State => JSON.parse(fs.readFileSync(stateFile, 'utf8'));
      save({ ...st, checkouts: co });
      const gh = createFakeGh(root, handler(stateFile));
      fs.writeFileSync(
        path.join(root, 'effect.js'),
        `const fs = require('fs'); const f = ${JSON.stringify(stateFile)};
const s = JSON.parse(fs.readFileSync(f, 'utf8'));
const repo = s.checkouts[fs.realpathSync(process.cwd())];
fs.appendFileSync(${JSON.stringify(path.join(root, 'harness-calls.txt'))}, repo + ' ' + process.argv[2] + '\\n');
const nr = /\\/deliver (\\d+)/.exec(process.argv[2])[1];
if (!s.noEffect) s.issues[repo + '#' + nr].state = 'closed';
fs.writeFileSync(f, JSON.stringify(s));`,
      );
      fs.writeFileSync(
        path.join(gh.bin, 'claude'),
        `#!/bin/sh\nnode ${JSON.stringify(path.join(root, 'effect.js'))} "$2"\n`,
        { mode: 0o755 },
      );
      fs.writeFileSync(path.join(gh.bin, 'osascript'), '#!/bin/sh\n', { mode: 0o755 });
      const run = (args: string[]) =>
        worker.run(['-Objective', 'o/telos#1', '-NoColor', ...args], {
          cwd: path.join(root, 'telos'),
          env: gh.env({ ...process.env, HOME: home, AGENT_EVENTS_DIR: undefined, NO_COLOR: '1' }),
        });
      const harness = () => {
        const f = path.join(root, 'harness-calls.txt');
        return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n') : [];
      };
      return { root, home, gh, run, load, save, harness };
    }

    it('two repos, one waits for the rc of the other: round 1 delivers the ready repo, the end is gated; the same command resumes from GitHub', async () => {
      const c = setup(twoRepos());
      const r = await c.run([]);
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
      // never closes the objective: no write call at all
      expect(c.load().issues['o/telos#1'].state ?? 'open').toBe('open');
      expect(c.gh.calls().filter((x) => x.args[0] !== 'api' || x.args.includes('-X'))).toEqual([]);
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
