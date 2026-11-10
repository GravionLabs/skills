import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkEventsDir } from './agent-events';
import { createFakeGh } from './fake-gh';
import { reportEventCmd } from './report-progress';
import { PwshWorker } from './pwsh-worker';

export const PR = 'https://github.com/acme/app/pull/55';
export const step = (nr: number, name: string, result: string, pr = '') => [
  '-Type',
  'step.finished',
  '-Issue',
  String(nr),
  '-Step',
  name,
  '-Result',
  result,
  ...(pr ? ['-Pr', pr] : []),
];
export const attention = (nr: number, kind: string, reason = '') => [
  '-Type',
  'attention',
  '-Issue',
  String(nr),
  '-Kind',
  kind,
  ...(reason ? ['-Reason', reason] : []),
];

export type Issue = {
  body?: string;
  state?: string;
  milestone?: string;
  labels?: string[];
  children?: number[];
  blockers?: { number: number; state: string }[];
};
export type Fixture = {
  issues: Record<number, Issue>;
  milestones?: Record<string, number[]>;
  effect?: 'none' | 'close-first' | 'hold-first';
  stream?: object[];
  stopBefore?: boolean; // gh creates the stop file of the run once the run directory exists (before iteration 1)
  stopDuring?: boolean; // the harness stub creates the stop file of the run during the iteration
  stderr?: string; // the harness stub prints this line to stderr after its stream
  events?: string[][]; // Report-Progress.ps1 arguments the harness stub runs after its stream
};

export const pbi = (extra: Issue = {}): Issue => ({ labels: ['pbi'], ...extra });

export class DeliverLoopFixture {
  private dir = '';
  cwd = '';
  private seq = 0;
  private worker!: PwshWorker;

  constructor(private readonly script: string) {}

  start(): void {
    this.dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deliver-loop-')));
    this.worker = new PwshWorker(this.script);
  }

  stop(): void {
    this.worker.close();
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  setup = (fx: Fixture) => {
    this.cwd = path.join(this.dir, `case-${++this.seq}`);
    fs.mkdirSync(this.cwd, { recursive: true });
    const state = path.join(this.cwd, 'state.json');
    const full = { effect: 'none', milestones: {}, stream: [], events: [], ...fx };
    fs.writeFileSync(state, JSON.stringify(full));
    const gh = createFakeGh(
      this.cwd,
      `(call) => {
        const fs = require('fs');
        const s = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
        const a = call.args;
        if (s.stopBefore) {
          // the run directory of every run that already wrote run.started (its event file) gets the stop file
          const ev = require('path').join(process.cwd(), 'events');
          const root = require('path').join(process.cwd(), '.agents/deliver-loop');
          if (fs.existsSync(ev)) for (const f of fs.readdirSync(ev)) {
            const d = require('path').join(root, f.replace(/\\.jsonl$/, ''));
            fs.mkdirSync(d, { recursive: true });
            fs.writeFileSync(require('path').join(d, 'stop'), '');
          }
        }
        const get = (n) => { if (!s.issues[n]) throw new Error('no issue ' + n); return s.issues[n]; };
        let m = /^repos\\/\\{owner\\}\\/\\{repo\\}\\/issues\\/(\\d+)$/.exec(a[1] || '');
        if (a[0] === 'api' && m) {
          const i = get(m[1]);
          return { rest: { number: Number(m[1]), body: i.body || '', state: (i.state || 'OPEN').toLowerCase(), labels: (i.labels || []).map((name) => ({ name })), milestone: i.milestone ? { title: i.milestone } : null } };
        }
        // #127: the milestone is read over REST (Get-Milestones.ps1 -Mode issues), never with gh issue list
        if (/\\/milestones\\?/.test(a[1] || '')) {
          return { rest: [Object.keys(s.milestones).map((title, i) => ({ number: i + 1, title, state: 'open' }))] };
        }
        m = /issues\\?milestone=(\\d+)&state=(open|closed|all)/.exec(a[1] || '');
        if (m) {
          const nrs = s.milestones[Object.keys(s.milestones)[Number(m[1]) - 1]] || [];
          return { rest: [nrs.filter((n) => (m[2] === 'all' || (get(n).state || 'OPEN') === (m[2] === 'closed' ? 'CLOSED' : 'OPEN'))).map((number) => ({ number, title: 't', state: 'open', labels: (get(number).labels || []).map((name) => ({ name })), assignees: [] }))] };
        }
        if (a[0] === 'issue') throw new Error('GraphQL read: gh ' + a.join(' '));
        m = /issues\\/(\\d+)\\/sub_issues/.exec(a[1] || '');
        if (m) return { rest: (get(m[1]).children || []).map((number) => ({ number })) };
        m = /issues\\/(\\d+)\\/dependencies\\/blocked_by/.exec(a[1] || '');
        if (m) return { rest: get(m[1]).blockers || [] };
        throw new Error('unexpected gh ' + a.join(' '));
      }`,
    );
    // claude stub: records argv and the HERDR_ENV it sees, prints the stream, then applies the effect on the GitHub state
    fs.writeFileSync(
      path.join(this.cwd, 'effect.js'),
      `const fs = require('fs'); const f = ${JSON.stringify(state)};
const s = JSON.parse(fs.readFileSync(f, 'utf8'));
const first = Object.keys(s.issues).map(Number).find((n) => (s.issues[n].state || 'OPEN') === 'OPEN' && !(s.issues[n].labels || []).some((l) => l.startsWith('needs-') || l === 'interactive') && !(s.issues[n].blockers || []).some((b) => b.state === 'open') && ['pbi', 'bug'].some((l) => (s.issues[n].labels || []).includes(l)));
if (s.effect === 'close-first') s.issues[first].state = 'CLOSED';
if (s.effect === 'hold-first') s.issues[first].labels.push('needs-decision');
fs.writeFileSync(f, JSON.stringify(s));`,
    );
    fs.writeFileSync(
      path.join(this.cwd, 'stream.jsonl'),
      full.stream.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    const bin = path.join(this.cwd, 'bin');
    const events = full.events
      .map(
        (e) => reportEventCmd(e) + (full.stopDuring ? ` >> ${this.cwd}/stop-out.txt` : '') + '\n',
      )
      .join('');
    const stopDuring = full.stopDuring
      ? `echo now > "$(cat ${this.cwd}/.agents/deliver-loop/latest.txt)/stop"\n`
      : '';
    const stderrLine = full.stderr ? `echo ${JSON.stringify(full.stderr)} >&2\n` : '';
    const stub = (name: string, body: string) =>
      fs.writeFileSync(path.join(gh.bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    stub(
      'claude',
      `echo "$*" >> ${this.cwd}/harness-calls.txt\necho "herdr_env=[$HERDR_ENV]" >> ${this.cwd}/harness-calls.txt\necho "ceiling=[$CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS] copilot_wait=[$COPILOT_TASK_WAIT_TIMEOUT_SECONDS]" >> ${this.cwd}/harness-calls.txt\ncat ${this.cwd}/stream.jsonl\n${stderrLine}${stopDuring}${events}node ${this.cwd}/effect.js`,
    );
    stub(
      'copilot',
      `echo "$*" >> ${this.cwd}/harness-calls.txt\necho "herdr_env=[$HERDR_ENV]" >> ${this.cwd}/harness-calls.txt\necho "ceiling=[$CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS] copilot_wait=[$COPILOT_TASK_WAIT_TIMEOUT_SECONDS]" >> ${this.cwd}/harness-calls.txt\ncat ${this.cwd}/stream.jsonl\n${stderrLine}${stopDuring}${events}node ${this.cwd}/effect.js`,
    );
    stub('herdr', `echo "$*" >> ${this.cwd}/herdr-calls.txt`);
    stub('osascript', `echo "$*" >> ${this.cwd}/notices.txt`);
    void bin;
    return gh;
  };
  read = (f: string) => {
    const p = path.join(this.cwd, f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };
  // the wait-ceiling variables each harness call saw, e.g. 'ceiling=[0] copilot_wait=[]'
  harnessWaits = () =>
    this.read('harness-calls.txt')
      .split('\n')
      .filter((l) => l.startsWith('ceiling='));
  harnessCalls = () =>
    this.read('harness-calls.txt')
      .split('\n')
      .filter((l) => l.startsWith('-p'));
  // Runs the loop; every run file it and the harness stub wrote must be a valid agent-events run with the deliver
  // profile (#452), else the run throws with the errors.
  run = async (
    gh: ReturnType<typeof createFakeGh>,
    args: string[],
    env: NodeJS.ProcessEnv = {},
  ) => {
    const r = await this.worker.run(args, {
      cwd: this.cwd,
      env: { ...gh.env(), HERDR_ENV: '', NO_COLOR: '', ...env },
    });
    for (const dir of [env.AGENT_EVENTS_DIR, path.join(this.cwd, '.agents/events')]) {
      if (!dir || !fs.existsSync(dir)) continue;
      const errors = checkEventsDir(dir);
      if (Object.keys(errors).length)
        throw new Error(`invalid run files: ${JSON.stringify(errors)}`);
    }
    return r;
  };
}
