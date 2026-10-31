import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

type Issue = {
  state?: string;
  labels?: string[];
  children?: number[];
  blockers?: { number: number; state: string }[];
};
type Fixture = {
  issues: Record<number, Issue>;
  milestones?: Record<string, number[]>;
  effect?: 'none' | 'close-first' | 'hold-first';
  stream?: object[];
};

// #893: stop rules and observability of Invoke-DeliverLoop.ps1 with gh, claude, herdr and osascript as stubs on PATH.
// All cases share one PwshWorker (the script writes its steps with Write-Host, which the worker captures as stdout);
// only 'needs a target' is its own spawn: it reads the message the script writes to the console's stderr.
describe.skipIf(!hasPwsh || process.platform === 'win32')('Invoke-DeliverLoop.ps1', () => {
  let dir: string;
  let cwd: string;
  let seq = 0;

  let worker: PwshWorker;

  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deliver-loop-')));
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const setup = (fx: Fixture) => {
    cwd = path.join(dir, `case-${++seq}`);
    fs.mkdirSync(cwd, { recursive: true });
    const state = path.join(cwd, 'state.json');
    const full = { effect: 'none', milestones: {}, stream: [], ...fx };
    fs.writeFileSync(state, JSON.stringify(full));
    const gh = createFakeGh(
      cwd,
      `(call) => {
        const fs = require('fs');
        const s = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
        const a = call.args;
        const get = (n) => { if (!s.issues[n]) throw new Error('no issue ' + n); return s.issues[n]; };
        if (a[0] === 'issue' && a[1] === 'view') {
          const i = get(a[2]);
          return { rest: { number: Number(a[2]), state: i.state || 'OPEN', labels: (i.labels || []).map((name) => ({ name })) } };
        }
        if (a[0] === 'issue' && a[1] === 'list') {
          return { rest: (s.milestones[a[a.indexOf('--milestone') + 1]] || []).map((number) => ({ number })) };
        }
        let m = /issues\\/(\\d+)\\/sub_issues/.exec(a[1] || '');
        if (m) return { rest: (get(m[1]).children || []).map((number) => ({ number })) };
        m = /issues\\/(\\d+)\\/dependencies\\/blocked_by/.exec(a[1] || '');
        if (m) return { rest: get(m[1]).blockers || [] };
        throw new Error('unexpected gh ' + a.join(' '));
      }`,
    );
    // claude stub: records argv and the HERDR_ENV it sees, prints the stream, then applies the effect on the GitHub state
    fs.writeFileSync(
      path.join(cwd, 'effect.js'),
      `const fs = require('fs'); const f = ${JSON.stringify(state)};
const s = JSON.parse(fs.readFileSync(f, 'utf8'));
const first = Object.keys(s.issues).map(Number).find((n) => (s.issues[n].state || 'OPEN') === 'OPEN' && !(s.issues[n].labels || []).some((l) => l.startsWith('needs-') || l === 'interactive') && !(s.issues[n].blockers || []).some((b) => b.state === 'open') && (s.issues[n].labels || []).includes('pbi'));
if (s.effect === 'close-first') s.issues[first].state = 'CLOSED';
if (s.effect === 'hold-first') s.issues[first].labels.push('needs-decision');
fs.writeFileSync(f, JSON.stringify(s));`,
    );
    fs.writeFileSync(
      path.join(cwd, 'stream.jsonl'),
      full.stream.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    const bin = path.join(cwd, 'bin');
    const stub = (name: string, body: string) =>
      fs.writeFileSync(path.join(gh.bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    stub(
      'claude',
      `echo "$*" >> ${cwd}/claude-calls.txt\necho "herdr_env=[$HERDR_ENV]" >> ${cwd}/claude-calls.txt\ncat ${cwd}/stream.jsonl\nnode ${cwd}/effect.js`,
    );
    stub('herdr', `echo "$*" >> ${cwd}/herdr-calls.txt`);
    stub('osascript', `echo "$*" >> ${cwd}/notices.txt`);
    void bin;
    return gh;
  };
  const read = (f: string) => {
    const p = path.join(cwd, f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };
  const claudeCalls = () =>
    read('claude-calls.txt')
      .split('\n')
      .filter((l) => l.startsWith('-p'));
  const run = (gh: ReturnType<typeof createFakeGh>, args: string[], env: NodeJS.ProcessEnv = {}) =>
    worker.run(args, { cwd, env: { ...gh.env(), HERDR_ENV: '', NO_COLOR: '', ...env } });
  const pbi = (extra: Issue = {}): Issue => ({ labels: ['pbi'], ...extra });

  describe('arguments', () => {
    it('needs a target or a milestone', () => {
      const gh = setup({ issues: {} });
      const r = spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT], {
        cwd,
        encoding: 'utf8',
        env: gh.env(),
      });
      expect(r.status).toBe(64);
      expect(r.stderr).toContain('-Target');
    });

    it.each([
      [['-Target', '1', '-Harness', 'opencode']],
      [['-Target', '1', '-Max', '0']],
      [['-Target', 'abc']],
    ])('rejects %j', async (args) => {
      const r = await run(setup({ issues: { 1: pbi() } }), args);
      expect(r.status).not.toBe(0);
      expect(claudeCalls()).toEqual([]);
    });
  });

  describe('stop rules', () => {
    it('-Milestone -Max 1 delivers exactly one PBI in one fresh process and stops', async () => {
      const gh = setup({
        issues: { 10: pbi({ blockers: [{ number: 5, state: 'closed' }] }), 11: pbi() },
        milestones: { '0.13': [10, 11] },
        effect: 'close-first',
      });
      const r = await run(gh, ['-Milestone', '0.13', '-Max', '1']);
      expect(r.status).toBe(0);
      expect(claudeCalls()).toEqual([
        '-p /deliver --milestone 0.13 --unattended --max 1 --model sonnet --permission-mode auto --output-format stream-json --verbose',
      ]);
      expect(r.stdout).toContain('loop result: max reached');
    });

    it('passes targets and -Model on and runs until nothing is open (Feature expanded to its PBIs)', async () => {
      const gh = setup({
        issues: {
          100: { labels: ['feature'], children: [101, 102, 103] },
          101: pbi(),
          102: pbi({ blockers: [{ number: 101, state: 'open' }] }),
          103: pbi({ state: 'CLOSED' }),
        },
        effect: 'close-first',
      });
      // after the first iteration #101 is closed, but its state file keeps the blocker of 102 open: clear it in the effect
      const st = path.join(cwd, 'state.json');
      fs.writeFileSync(
        path.join(cwd, 'effect.js'),
        `const fs = require('fs'); const s = JSON.parse(fs.readFileSync(${JSON.stringify(st)}, 'utf8'));
const n = Object.keys(s.issues).map(Number).find((k) => k > 100 && s.issues[k].state !== 'CLOSED' && !(s.issues[k].blockers || []).some((b) => b.state === 'open'));
s.issues[n].state = 'CLOSED';
for (const i of Object.values(s.issues)) i.blockers = (i.blockers || []).filter((b) => b.number !== n);
fs.writeFileSync(${JSON.stringify(st)}, JSON.stringify(s));`,
      );
      const r = await run(gh, ['-Target', '100', '-Model', 'opus']);
      expect(r.status).toBe(0);
      const calls = claudeCalls();
      expect(calls).toHaveLength(2);
      expect(calls[0]).toBe(
        '-p /deliver 100 --unattended --max 1 --model opus --permission-mode auto --output-format stream-json --verbose',
      );
      expect(r.stdout).toContain('loop result: done');
    });

    it('stops with "no progress" and the last log lines when a PBI stays open', async () => {
      const gh = setup({
        issues: { 10: pbi() },
        effect: 'none',
        stream: [
          { type: 'assistant', message: { content: [{ type: 'text', text: 'working on it' }] } },
        ],
      });
      const r = await run(gh, ['-Target', '10']);
      expect(r.status).toBe(1);
      expect(claudeCalls()).toHaveLength(1);
      expect(r.stdout).toContain('no progress');
      expect(r.stdout).toMatch(/ {2}\d\d:\d\d:\d\d » working on it/);
    });

    it('is blocked when the only PBI waits on an open blocker, without starting the harness', async () => {
      const r = await run(
        setup({ issues: { 10: pbi({ blockers: [{ number: 5, state: 'open' }] }) } }),
        ['-Target', '10'],
      );
      expect(r.status).toBe(2);
      expect(claudeCalls()).toEqual([]);
      expect(r.stdout).toContain('loop result: blocked');
    });

    it('a paused PBI counts as progress; what remains behind labels ends as blocked', async () => {
      const gh = setup({
        issues: { 10: pbi(), 11: pbi({ labels: ['pbi', 'needs-refinement'] }) },
        effect: 'hold-first',
      });
      const r = await run(gh, ['-Target', '10,11']);
      expect(claudeCalls()).toHaveLength(1);
      expect(r.status).toBe(2);
      expect(r.stdout).toContain('loop result: blocked');
    });

    it('counts an interactive PBI as held: one iteration for the ready one, then blocked', async () => {
      const gh = setup({
        issues: { 10: pbi(), 11: pbi({ labels: ['pbi', 'interactive'] }) },
        effect: 'close-first',
      });
      const r = await run(gh, ['-Target', '10,11']);
      expect(claudeCalls()).toHaveLength(1);
      expect(r.status).toBe(2);
      expect(r.stdout).toContain('loop result: blocked');
    });

    it('is done at once when nothing is open, reads or writes no queue file; outside herdr it touches no herdr', async () => {
      // outside herdr (#12): no pane is attempted, no display is set and no error is printed
      const r = await run(setup({ issues: { 10: pbi({ state: 'CLOSED' }) } }), ['-Target', '10'], {
        HERDR_PANE_ID: 'w1:p5',
        DELIVER_LOOP_ASSUME_TTY: '1',
      });
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(read('herdr-calls.txt')).toBe('');
      expect(r.stdout).toContain('loop result: done');
      expect(claudeCalls()).toEqual([]);
      const files = fs.readdirSync(cwd, { recursive: true }).map(String);
      expect(files.filter((f) => /queue/i.test(f))).toEqual([]);
    });
  });

  describe('observability', () => {
    const stream = [
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: '#401 pr: opened #55\nmore' }] },
      },
      {
        type: 'assistant',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'a1',
              name: 'Agent',
              input: { description: 'Review PBI #401 diff' },
            },
          ],
        },
      },
      {
        type: 'assistant',
        parent_tool_use_id: 'a1',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 't1',
              name: 'Bash',
              input: { description: 'git diff', command: 'git diff' },
            },
          ],
        },
      },
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'src/a.ts' } }],
        },
      },
      {
        type: 'user',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 't2', is_error: true, content: 'boom\nsecond' },
          ],
        },
      },
    ];

    it('logs one line per step with the agent prefix, tool errors and writes every record to the jsonl', async () => {
      const gh = setup({ issues: { 401: pbi() }, effect: 'close-first', stream });
      const r = await run(gh, ['-Target', '401']);
      expect(r.status).toBe(0);
      const lines = read('.agents/deliver-loop.log');
      expect(lines).toMatch(/\d\d:\d\d:\d\d » #401 pr: opened #55/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d Agent Review PBI #401 diff/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d \[Review PBI #401 diff\] Bash git diff/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d Read src\/a\.ts/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d ✗ boom/);
      expect(r.stdout).toContain('[Review PBI #401 diff] Bash git diff');
      const runDirs = fs.readdirSync(path.join(cwd, '.agents/deliver-loop'));
      expect(runDirs).toHaveLength(1);
      const jsonl = fs
        .readFileSync(path.join(cwd, '.agents/deliver-loop', runDirs[0], '401.jsonl'), 'utf8')
        .trim()
        .split('\n');
      expect(jsonl.map((l) => JSON.parse(l))).toEqual(stream);
      if (process.platform === 'darwin') {
        // osascript stub: attention step and loop result
        const notes = read('notices.txt');
        expect(notes).toContain('#401 PR opened');
        expect(notes).toContain('loop result: done');
      }
    });

    it('owns the herdr display: harness runs without HERDR_ENV, position per progress line, cleared at the end', async () => {
      const gh = setup({ issues: { 401: pbi() }, effect: 'close-first', stream });
      await run(gh, ['-Target', '401'], { HERDR_ENV: '1', HERDR_PANE_ID: 'p7' });
      expect(read('claude-calls.txt')).toContain('herdr_env=[]');
      const calls = read('herdr-calls.txt').trim().split('\n');
      expect(calls).toContain(
        'pane report-metadata p7 --source deliver --display-agent deliver 1/1 #401 pr: opened #55',
      );
      expect(calls.at(-1)).toBe('pane report-metadata p7 --source deliver --clear-display-agent');
    });

    it('clears the herdr display when the loop fails', async () => {
      const gh = setup({ issues: { 10: pbi({ children: [] }) } });
      const r = await run(gh, ['-Target', '10,99'], { HERDR_ENV: '1', HERDR_PANE_ID: 'p7' });
      expect(r.status).not.toBe(0);
      expect(read('herdr-calls.txt').trim()).toBe(
        'pane report-metadata p7 --source deliver --clear-display-agent',
      );
    });
  });

  // #12: the herdr log pane and the plain versus ANSI log; herdr is a stub that answers
  // `pane list` from herdr-list.json and `pane split` with pane w1:p9 (or fails when split-fail exists).
  describe('log pane', () => {
    const ESC = String.fromCharCode(27);
    const paneStream = [
      {
        type: 'assistant',
        message: {
          content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'src/a.ts' } }],
        },
      },
      {
        type: 'user',
        message: {
          content: [{ type: 'tool_result', tool_use_id: 't1', is_error: true, content: 'boom' }],
        },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: '#401 ci: red' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '#401 merged: squash' }] } },
    ];
    const panes = (list: object[]) => ({
      id: 'cli:pane:list',
      result: { panes: list, type: 'pane_list' },
    });
    const own = { pane_id: 'w1:p5', tab_id: 'w1:t5', label: 'skills' };
    // without `stream` #401 is closed, so the loop is done at once (no harness run): only the pane cases need no stream
    const prepare = (opts: { list?: object; splitFails?: boolean; stream?: boolean } = {}) => {
      const gh = opts.stream
        ? setup({ issues: { 401: pbi() }, effect: 'close-first', stream: paneStream })
        : setup({ issues: { 401: pbi({ state: 'CLOSED' }) } });
      fs.writeFileSync(
        path.join(cwd, 'herdr-list.json'),
        JSON.stringify(opts.list ?? panes([own])),
      );
      if (opts.splitFails) fs.writeFileSync(path.join(cwd, 'split-fail'), '');
      fs.writeFileSync(
        path.join(gh.bin, 'herdr'),
        `#!/bin/sh
echo "$*" >> ${cwd}/herdr-calls.txt
case "$1 $2" in
  "pane list") cat ${cwd}/herdr-list.json ;;
  "pane split") [ -f ${cwd}/split-fail ] && { echo "no split" >&2; exit 1; }; echo '{"id":"cli:pane:split","result":{"pane":{"pane_id":"w1:p9"}}}' ;;
esac
`,
        { mode: 0o755 },
      );
      return gh;
    };
    const herdrEnv = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p5', DELIVER_LOOP_ASSUME_TTY: '1' };
    const go = (gh: ReturnType<typeof createFakeGh>, args: string[], env: NodeJS.ProcessEnv) =>
      run(gh, ['-Target', '401', ...args], env);
    const paneCalls = () =>
      read('herdr-calls.txt')
        .split('\n')
        .filter((l) => l && !l.startsWith('pane report-metadata'));

    it('opens one pane below that tails the ANSI log, labels it deliver-log and leaves it open', async () => {
      // a deliver-log pane of another tab does not count
      const list = panes([own, { pane_id: 'w2:p1', tab_id: 'w2:t1', label: 'deliver-log' }]);
      const r = await go(prepare({ list }), [], herdrEnv);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(paneCalls()).toEqual([
        'pane list',
        'pane split --current --direction down --ratio 0.7 --no-focus',
        `pane run w1:p9 pwsh -NoProfile -Command "Get-Content -Tail 40 -Wait '${path.join(cwd, '.agents/deliver-loop.ansi.log')}'"`,
        'pane rename w1:p9 deliver-log',
      ]);
    });

    it('opens no second pane when the tab already has one labeled deliver-log', async () => {
      const list = panes([
        own,
        { pane_id: 'w1:p6', tab_id: 'w1:t5', label: 'deliver-log' },
        { pane_id: 'w2:p1', tab_id: 'w2:t1', label: 'other' },
      ]);
      await go(prepare({ list }), [], herdrEnv);
      expect(paneCalls()).toEqual(['pane list']);
    });

    // outside herdr: see 'is done at once'
    it('stdout redirected: attempts no pane and prints no error', async () => {
      const r = await go(prepare(), [], { ...herdrEnv, DELIVER_LOOP_ASSUME_TTY: '' });
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(paneCalls()).toEqual([]);
    });

    it('a failing split is ignored and the loop runs on', async () => {
      const r = await go(prepare({ splitFails: true }), [], herdrEnv);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(paneCalls()).toEqual([
        'pane list',
        'pane split --current --direction down --ratio 0.7 --no-focus',
      ]);
      expect(read('.agents/deliver-loop.log')).toContain('loop result: done');
    });

    it('-NoPane: opens no pane; writes the plain log without escape codes and the colored ANSI log', async () => {
      await go(prepare({ stream: true }), ['-NoPane'], herdrEnv);
      expect(paneCalls()).toEqual([]);
      const plain = read('.agents/deliver-loop.log');
      expect(plain).toMatch(/\d\d:\d\d:\d\d ✗ boom/);
      expect(plain).not.toContain(ESC);
      const ansi = read('.agents/deliver-loop.ansi.log');
      expect(ansi).toMatch(new RegExp(`${ESC}\\[2m\\d\\d:\\d\\d:\\d\\d${ESC}\\[0m `));
      expect(ansi).toContain(`${ESC}[36mRead${ESC}[0m src/a.ts`);
      expect(ansi).toContain(`${ESC}[31m✗ boom${ESC}[0m`);
      expect(ansi).toContain(`${ESC}[33m» #401 ci: red${ESC}[0m`);
      expect(ansi).toContain(`${ESC}[32m» #401 merged: squash${ESC}[0m`);
      expect(ansi).toContain(`${ESC}[32mloop result: done`);
    });

    // -NoColor takes the same branch as NO_COLOR
    it('NO_COLOR: no ANSI log, the pane tails the plain log', async () => {
      await go(prepare(), [], { ...herdrEnv, NO_COLOR: '1' });
      expect(fs.existsSync(path.join(cwd, '.agents/deliver-loop.ansi.log'))).toBe(false);
      expect(read('.agents/deliver-loop.log')).not.toContain(ESC);
      expect(paneCalls()).toContain(
        `pane run w1:p9 pwsh -NoProfile -Command "Get-Content -Tail 40 -Wait '${path.join(cwd, '.agents/deliver-loop.log')}'"`,
      );
    });
  });
});
