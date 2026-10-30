import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';

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
// Each case is its own pwsh spawn: the script reads the environment, writes the console directly and calls exit.
describe.skipIf(!hasPwsh || process.platform === 'win32')('Invoke-DeliverLoop.ps1', () => {
  let dir: string;
  let cwd: string;
  let seq = 0;

  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deliver-loop-')));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

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
    spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...gh.env(), HERDR_ENV: '', ...env },
    });
  const pbi = (extra: Issue = {}): Issue => ({ labels: ['pbi'], ...extra });

  describe('arguments', () => {
    it('needs a target or a milestone', () => {
      const r = run(setup({ issues: {} }), []);
      expect(r.status).toBe(64);
      expect(r.stderr).toContain('-Target');
    });

    it.each([
      [['-Target', '1', '-Harness', 'opencode']],
      [['-Target', '1', '-Max', '0']],
      [['-Target', 'abc']],
    ])('rejects %j', (args) => {
      const r = run(setup({ issues: { 1: pbi() } }), args);
      expect(r.status).not.toBe(0);
      expect(claudeCalls()).toEqual([]);
    });
  });

  describe('stop rules', () => {
    it('-Milestone -Max 1 delivers exactly one PBI in one fresh process and stops', () => {
      const gh = setup({
        issues: { 10: pbi({ blockers: [{ number: 5, state: 'closed' }] }), 11: pbi() },
        milestones: { '0.13': [10, 11] },
        effect: 'close-first',
      });
      const r = run(gh, ['-Milestone', '0.13', '-Max', '1']);
      expect(r.status).toBe(0);
      expect(claudeCalls()).toEqual([
        '-p /deliver --milestone 0.13 --unattended --max 1 --model sonnet --permission-mode auto --output-format stream-json --verbose',
      ]);
      expect(r.stdout).toContain('loop result: max reached');
    });

    it('passes targets and -Model on and runs until nothing is open (Feature expanded to its PBIs)', () => {
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
      const r = run(gh, ['-Target', '100', '-Model', 'opus']);
      expect(r.status).toBe(0);
      const calls = claudeCalls();
      expect(calls).toHaveLength(2);
      expect(calls[0]).toBe(
        '-p /deliver 100 --unattended --max 1 --model opus --permission-mode auto --output-format stream-json --verbose',
      );
      expect(r.stdout).toContain('loop result: done');
    });

    it('stops with "no progress" and the last log lines when a PBI stays open', () => {
      const gh = setup({
        issues: { 10: pbi() },
        effect: 'none',
        stream: [
          { type: 'assistant', message: { content: [{ type: 'text', text: 'working on it' }] } },
        ],
      });
      const r = run(gh, ['-Target', '10']);
      expect(r.status).toBe(1);
      expect(claudeCalls()).toHaveLength(1);
      expect(r.stdout).toContain('no progress');
      expect(r.stdout).toMatch(/ {2}\d\d:\d\d:\d\d » working on it/);
    });

    it('is blocked when the only PBI waits on an open blocker, without starting the harness', () => {
      const r = run(setup({ issues: { 10: pbi({ blockers: [{ number: 5, state: 'open' }] }) } }), [
        '-Target',
        '10',
      ]);
      expect(r.status).toBe(2);
      expect(claudeCalls()).toEqual([]);
      expect(r.stdout).toContain('loop result: blocked');
    });

    it('a paused PBI counts as progress; what remains behind labels ends as blocked', () => {
      const gh = setup({
        issues: { 10: pbi(), 11: pbi({ labels: ['pbi', 'needs-refinement'] }) },
        effect: 'hold-first',
      });
      const r = run(gh, ['-Target', '10,11']);
      expect(claudeCalls()).toHaveLength(1);
      expect(r.status).toBe(2);
      expect(r.stdout).toContain('loop result: blocked');
    });

    it('counts an interactive PBI as held: one iteration for the ready one, then blocked', () => {
      const gh = setup({
        issues: { 10: pbi(), 11: pbi({ labels: ['pbi', 'interactive'] }) },
        effect: 'close-first',
      });
      const r = run(gh, ['-Target', '10,11']);
      expect(claudeCalls()).toHaveLength(1);
      expect(r.status).toBe(2);
      expect(r.stdout).toContain('loop result: blocked');
    });

    it('is done at once when nothing is open, and reads or writes no queue file', () => {
      const r = run(setup({ issues: { 10: pbi({ state: 'CLOSED' }) } }), ['-Target', '10']);
      expect(r.status).toBe(0);
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

    it('logs one line per step with the agent prefix, tool errors and writes every record to the jsonl', () => {
      const gh = setup({ issues: { 401: pbi() }, effect: 'close-first', stream });
      const r = run(gh, ['-Target', '401']);
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

    it('owns the herdr display: harness runs without HERDR_ENV, position per progress line, cleared at the end', () => {
      const gh = setup({ issues: { 401: pbi() }, effect: 'close-first', stream });
      run(gh, ['-Target', '401'], { HERDR_ENV: '1', HERDR_PANE_ID: 'p7' });
      expect(read('claude-calls.txt')).toContain('herdr_env=[]');
      const calls = read('herdr-calls.txt').trim().split('\n');
      expect(calls).toContain(
        'pane report-metadata p7 --source deliver --display-agent deliver 1/1 #401 pr: opened #55',
      );
      expect(calls.at(-1)).toBe('pane report-metadata p7 --source deliver --clear-display-agent');
    });

    it('clears the herdr display when the loop fails', () => {
      const gh = setup({ issues: { 10: pbi({ children: [] }) } });
      const r = run(gh, ['-Target', '10,99'], { HERDR_ENV: '1', HERDR_PANE_ID: 'p7' });
      expect(r.status).not.toBe(0);
      expect(read('herdr-calls.txt').trim()).toBe(
        'pane report-metadata p7 --source deliver --clear-display-agent',
      );
    });

    it('does not touch herdr without HERDR_ENV=1', () => {
      const gh = setup({ issues: { 401: pbi() }, effect: 'close-first', stream });
      run(gh, ['-Target', '401'], { HERDR_PANE_ID: 'p7' });
      expect(read('herdr-calls.txt')).toBe('');
    });
  });
});
