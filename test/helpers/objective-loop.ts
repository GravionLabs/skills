import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createFakeGh } from './fake-gh';
import type { PwshWorker } from './pwsh-worker';

// Fixture of Invoke-DeliverLoop.ps1 -Objective (#543, #544). A fake gh serves the GitHub state of several repositories from
// one state file (`{owner}/{repo}` from the checkout the call runs in); comment writes (the runner marker, the status
// comment) change `comments`, every other write throws. A fake claude runs effect.js: it closes the PBI of its prompt in
// the repository of its cwd and, per `s.effect`, takes the runner over or requests a release during the PBI.
export type Iss = {
  title?: string;
  state?: 'open' | 'closed';
  labels?: string[];
  body?: string;
  children?: string[];
  blockers?: string[];
};
export type Comment = { id: number; body: string };
export type State = {
  issues: Record<string, Iss>;
  milestones: Record<string, { number: number; title: string; state: string }[]>;
  rcPosted: boolean;
  checkouts: Record<string, string>;
  comments?: Record<string, Comment[]>;
  noEffect?: boolean;
  prs?: Record<string, unknown[]>;
  contractPr?: boolean;
  noRcPost?: boolean;
  effect?: 'takeover' | 'release';
  // #548: the fake claude sleeps this long per PBI and appends `<repo> start|end <ms>` to harness-times.txt
  sleepMs?: number;
};

export const marker = (host: string, heartbeat: string, since = heartbeat) =>
  `<!-- objective-runner: host=${host} since=${since} heartbeat=${heartbeat} -->`;

const handler = (stateFile: string) => `(call, ctx) => {
  const fs = require('fs'); const cp = require('child_process');
  const f = ${JSON.stringify(stateFile)};
  const load = () => JSON.parse(fs.readFileSync(f, 'utf8'));
  const a = call.args;
  // #548: every read of the rate limit adds 10 REST and 3 GraphQL calls
  if (a[0] === 'api' && a[1] === 'rate_limit') {
    const n = ctx.count('rate_limit');
    return { rest: { resources: { core: { used: 10 * n, remaining: 5000 - 10 * n }, graphql: { used: 3 * n, remaining: 5000 - 3 * n } } } };
  }
  const xi = a.indexOf('-X');
  const method = xi >= 0 ? a[xi + 1] : 'GET';
  if (a[0] === 'repo' && a[1] === 'clone') {
    cp.execSync('git init -q ' + JSON.stringify(a[3]) + ' && git -C ' + JSON.stringify(a[3]) + ' remote add origin https://github.com/' + a[2] + '.git');
    const s = load(); s.checkouts[fs.realpathSync(a[3])] = a[2]; fs.writeFileSync(f, JSON.stringify(s));
    return { rest: '' };
  }
  if (a[0] !== 'api') throw new Error('unexpected gh ' + a.join(' '));
  const s = load();
  const here = s.checkouts[fs.realpathSync(process.cwd())];
  const p = a.find((x) => x.startsWith('repos/')).replace('{owner}/{repo}', here || 'unknown/unknown');
  const bare = p.split('?')[0];
  let m;
  if (method !== 'GET') {
    const bi = a.indexOf('-f');
    const body = bi >= 0 ? a[bi + 1].replace(/^body=/, '') : (call.body || {}).body || '';
    s.comments = s.comments || {};
    let out = '';
    const input = call.body || {};
    if (method === 'POST' && (m = /^repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)\\/labels$/.exec(bare))) {
      const k = m[1] + '#' + m[2]; if (!s.issues[k]) throw new Error('404 ' + k);
      s.issues[k].labels = (s.issues[k].labels || ['pbi']).concat(input.labels); out = [];
    } else if (method === 'POST' && (m = /^repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)\\/comments$/.exec(bare))) {
      const id = 1000 + Object.values(s.comments).flat().length + Math.floor(Math.random() * 1000);
      (s.comments[m[1] + '#' + m[2]] = s.comments[m[1] + '#' + m[2]] || []).push({ id, body });
      out = { id };
    } else if ((m = /^repos\\/[^/]+\\/[^/]+\\/issues\\/comments\\/(\\d+)$/.exec(bare)) && ['PATCH', 'DELETE'].includes(method)) {
      const id = Number(m[1]);
      const key = Object.keys(s.comments).find((k) => s.comments[k].some((c) => c.id === id));
      if (!key) throw new Error('404 comment ' + id);
      if (method === 'PATCH') { s.comments[key].find((c) => c.id === id).body = body; out = { id }; }
      else s.comments[key] = s.comments[key].filter((c) => c.id !== id);
    } else throw new Error('write: ' + a.join(' '));
    fs.writeFileSync(f, JSON.stringify(s));
    return { rest: out };
  }
  const issue = (key) => {
    const i = s.issues[key]; if (!i) throw new Error('404 ' + key);
    const [repo, nr] = key.split('#');
    return { number: Number(nr), title: i.title || 'T' + nr, state: i.state || 'open', body: i.body || '',
      labels: (i.labels || ['pbi']).map((name) => ({ name })), repository_url: 'https://api.github.com/repos/' + repo,
      issue_dependencies_summary: { blocked_by: (i.blockers || []).length } };
  };
  let v;
  if ((m = /^repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)$/.exec(bare))) v = issue(m[1] + '#' + m[2]);
  else if ((m = /^repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)\\/sub_issues$/.exec(bare))) v = (s.issues[m[1] + '#' + m[2]].children || []).map(issue);
  else if ((m = /^repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)\\/dependencies\\/blocked_by$/.exec(bare))) v = (s.issues[m[1] + '#' + m[2]].blockers || []).map(issue);
  else if ((m = /^repos\\/([^/]+\\/[^/]+)\\/issues\\/(\\d+)\\/comments$/.exec(bare))) {
    const own = (s.comments || {})[m[1] + '#' + m[2]];
    v = own ? own : s.rcPosted ? [{ id: 1, body: '<!-- release-test-rc --> RC 1.0.0-rc.1' }] : [];
  }
  else if ((m = /^repos\\/([^/]+\\/[^/]+)\\/milestones$/.exec(bare))) v = s.milestones[m[1]] || [];
  else if ((m = /^repos\\/([^/]+\\/[^/]+)\\/issues$/.exec(bare)) && !p.includes('labels=release-test')) v = Object.keys(s.issues).filter((k) => k.startsWith(m[1] + '#') && (s.issues[k].state || 'open') === 'open' && !(s.issues[k].labels || ['pbi']).includes('release-test')).map(issue);
  else if ((m = /^repos\\/([^/]+\\/[^/]+)\\/issues$/.exec(bare))) v = Object.keys(s.issues).filter((k) => k.startsWith(m[1] + '#') && (s.issues[k].labels || []).includes('release-test')).map(issue);
  else if ((m = /^repos\\/([^/]+\\/[^/]+)\\/pulls$/.exec(bare))) v = p.includes('state=closed') ? (s.prs || {})[m[1]] || [] : [];
  else if (/^repos\\/[^/]+\\/[^/]+$/.test(bare)) v = { default_branch: 'main' };
  else throw new Error('unexpected gh ' + a.join(' '));
  return { rest: a.includes('--paginate') ? [v] : v };
}`;

// effect.js of the fake claude. effect 'takeover': another host sets the marker during the PBI and keeps it until the
// repository loop got its stop file. effect 'release': `deliver-loop release` (Set-ObjectiveRunner.ps1) during the PBI.
const effect = (
  stateFile: string,
  calls: string,
  runnerScript: string,
) => `const fs = require('fs'); const cp = require('child_process');
const path = require('path');
const f = ${JSON.stringify(stateFile)};
const load = () => JSON.parse(fs.readFileSync(f, 'utf8'));
let s = load();
const repo = s.checkouts[fs.realpathSync(process.cwd())];
fs.appendFileSync(${JSON.stringify(calls)}, repo + ' ' + process.argv[2] + '\\n');
const ms = /\\/deliver --milestone (\\S+)/.exec(process.argv[2]);
if (ms) { if (!s.noRcPost) s.rcPosted = true; fs.writeFileSync(f, JSON.stringify(s)); process.exit(0); }
const nr = /\\/deliver (\\d+)/.exec(process.argv[2])[1];
const times = path.join(path.dirname(f), 'harness-times.txt');
if (s.sleepMs) {
  fs.appendFileSync(times, repo + ' start ' + Date.now() + '\\n');
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, s.sleepMs);
  fs.appendFileSync(times, repo + ' end ' + Date.now() + '\\n');
  s = load(); // the other repository's harness wrote the state while this one slept
}
if (!s.noEffect) {
  s.issues[repo + '#' + nr].state = 'closed';
  if (s.contractPr) { s.prs = s.prs || {}; (s.prs[repo] = s.prs[repo] || []).push({ number: 100 + Number(nr), html_url: 'https://github.com/' + repo + '/pull/' + (100 + Number(nr)), merged_at: new Date().toISOString().replace(/\\.\\d+Z$/, 'Z'), body: 'Closes #' + nr, labels: [] }); s.issues[repo + '#' + nr].labels = (s.issues[repo + '#' + nr].labels || ['pbi']).concat('contract-change'); } // deliver step 6 labels the PBI issue, not the PR (#570)
  fs.writeFileSync(f, JSON.stringify(s));
}
const stopFile = () => { const d = path.join(process.cwd(), '.agents/deliver-loop');
  return fs.existsSync(d) && fs.readdirSync(d).some((r) => fs.existsSync(path.join(d, r, 'stop'))); };
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
if (s.effect === 'takeover') {
  for (let i = 0; i < 100 && !stopFile(); i++) {
    s = load(); const c = Object.values(s.comments || {}).flat().find((x) => x.body.includes('objective-runner:'));
    const now = new Date().toISOString().replace(/\\.\\d+Z$/, 'Z');
    if (c && !c.body.includes('host=there')) { c.body = ${JSON.stringify(marker('there', 'NOW'))}.replace(/NOW/g, now); fs.writeFileSync(f, JSON.stringify(s)); }
    sleep(200);
  }
}
const beat = () => (Object.values(load().comments || {}).flat().find((x) => x.body.includes('objective-runner:')) || {}).body;
if (s.effect === 'release') {
  // the heartbeat timer refreshes the marker while the repository loop runs
  const first = beat();
  for (let i = 0; i < 50 && beat() === first; i++) sleep(200);
  fs.writeFileSync(path.join(path.dirname(f), 'beat-changed'), String(beat() !== first));
}
if (s.effect === 'release') cp.execFileSync('pwsh', ['-NoProfile', '-File', ${JSON.stringify(runnerScript)}, 'release', 'o/telos#1'], { stdio: 'inherit' });
`;

// objective o/telos#1 with Features o/a#10 (PBI 11) and o/b#20 (PBI 21); o/b requires an RC of o/a@M1
export const twoRepos = (): Omit<State, 'checkouts'> => ({
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

const gitRepo = (p: string, repo: string) => {
  fs.mkdirSync(p, { recursive: true });
  spawnSync('git', ['init', '-q', p]);
  spawnSync('git', ['-C', p, 'remote', 'add', 'origin', `https://github.com/${repo}.git`]);
};

// telos and a as siblings, b through ~/.config/deliver/checkouts.json, every other repo without a checkout
export function setupObjective(
  worker: PwshWorker,
  root: string,
  st: Omit<State, 'checkouts'>,
  env: NodeJS.ProcessEnv = {},
) {
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
  const calls = path.join(root, 'harness-calls.txt');
  const runnerScript = path.resolve(
    __dirname,
    '../../skills/delivery/deliver/scripts/Set-ObjectiveRunner.ps1',
  );
  fs.writeFileSync(path.join(root, 'effect.js'), effect(stateFile, calls, runnerScript));
  fs.writeFileSync(
    path.join(gh.bin, 'claude'),
    `#!/bin/sh\nnode ${JSON.stringify(path.join(root, 'effect.js'))} "$2"\n`,
    { mode: 0o755 },
  );
  fs.writeFileSync(path.join(gh.bin, 'osascript'), '#!/bin/sh\n', { mode: 0o755 });
  const fullEnv = gh.env({
    ...process.env,
    HOME: home,
    AGENT_EVENTS_DIR: undefined,
    NO_COLOR: '1',
    DELIVER_RUNNER_HOST: 'here',
    ...env,
  });
  const run = (args: string[]) =>
    worker.run(['-Objective', 'o/telos#1', '-NoColor', ...args], {
      cwd: path.join(root, 'telos'),
      env: fullEnv,
    });
  const harness = () =>
    fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [];
  const comments = (): Comment[] => load().comments?.['o/telos#1'] ?? [];
  return { root, home, gh, run, load, save, harness, comments, env: fullEnv };
}
