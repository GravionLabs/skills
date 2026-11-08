import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { reportEventCmd } from '../../helpers/report-progress';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

const PR = 'https://github.com/acme/app/pull/55';
const step = (nr: number, name: string, result: string, pr = '') => [
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
const attention = (nr: number, kind: string, reason = '') => [
  '-Type',
  'attention',
  '-Issue',
  String(nr),
  '-Kind',
  kind,
  ...(reason ? ['-Reason', reason] : []),
];

type Issue = {
  body?: string;
  state?: string;
  milestone?: string;
  labels?: string[];
  children?: number[];
  blockers?: { number: number; state: string }[];
};
type Fixture = {
  issues: Record<number, Issue>;
  milestones?: Record<string, number[]>;
  effect?: 'none' | 'close-first' | 'hold-first';
  stream?: object[];
  events?: string[][]; // Report-Progress.ps1 arguments the harness stub runs after its stream
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
    const full = { effect: 'none', milestones: {}, stream: [], events: [], ...fx };
    fs.writeFileSync(state, JSON.stringify(full));
    const gh = createFakeGh(
      cwd,
      `(call) => {
        const fs = require('fs');
        const s = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
        const a = call.args;
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
      path.join(cwd, 'effect.js'),
      `const fs = require('fs'); const f = ${JSON.stringify(state)};
const s = JSON.parse(fs.readFileSync(f, 'utf8'));
const first = Object.keys(s.issues).map(Number).find((n) => (s.issues[n].state || 'OPEN') === 'OPEN' && !(s.issues[n].labels || []).some((l) => l.startsWith('needs-') || l === 'interactive') && !(s.issues[n].blockers || []).some((b) => b.state === 'open') && ['pbi', 'bug'].some((l) => (s.issues[n].labels || []).includes(l)));
if (s.effect === 'close-first') s.issues[first].state = 'CLOSED';
if (s.effect === 'hold-first') s.issues[first].labels.push('needs-decision');
fs.writeFileSync(f, JSON.stringify(s));`,
    );
    fs.writeFileSync(
      path.join(cwd, 'stream.jsonl'),
      full.stream.map((r) => JSON.stringify(r)).join('\n') + '\n',
    );
    const bin = path.join(cwd, 'bin');
    const events = full.events.map((e) => reportEventCmd(e) + '\n').join('');
    const stub = (name: string, body: string) =>
      fs.writeFileSync(path.join(gh.bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    stub(
      'claude',
      `echo "$*" >> ${cwd}/harness-calls.txt\necho "herdr_env=[$HERDR_ENV]" >> ${cwd}/harness-calls.txt\ncat ${cwd}/stream.jsonl\n${events}node ${cwd}/effect.js`,
    );
    stub(
      'copilot',
      `echo "$*" >> ${cwd}/harness-calls.txt\necho "herdr_env=[$HERDR_ENV]" >> ${cwd}/harness-calls.txt\ncat ${cwd}/stream.jsonl\n${events}node ${cwd}/effect.js`,
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
  const harnessCalls = () =>
    read('harness-calls.txt')
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
      // unknown harness: fails before the first iteration with the supported list
      const h = spawnSync(
        'pwsh',
        ['-NoProfile', '-File', SCRIPT, '-Target', '1', '-Harness', 'opencode'],
        { cwd, encoding: 'utf8', env: gh.env() },
      );
      expect(h.status).toBe(64);
      expect(h.stderr).toContain('Supported: claude, copilot');
      expect(harnessCalls()).toEqual([]);
    });

    it('rejects -Max 0', async () => {
      const r = await run(setup({ issues: { 1: pbi() } }), ['-Target', '1', '-Max', '0']);
      expect(r.status).not.toBe(0);
      expect(harnessCalls()).toEqual([]);
    });
  });

  describe('harness', () => {
    // fixture: real output of copilot 1.0.105 (-p … --output-format json), trimmed to the event types the parser reads
    const live = fs
      .readFileSync(path.resolve(__dirname, 'fixtures/copilot-cli-1.0.105.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
    const events = [
      { type: 'assistant.message', data: { content: '#7 pr: opened #55\nmore' } },
      {
        type: 'tool.execution_start',
        data: { toolCallId: 'c1', toolName: 'bash', arguments: { command: 'ls -la' } },
      },
      {
        type: 'tool.execution_start',
        data: {
          toolCallId: 'c2',
          toolName: 'view',
          parentToolCallId: 'c0',
          arguments: { path: 'src/a.ts' },
        },
      },
      {
        type: 'tool.execution_complete',
        data: { toolCallId: 'c1', success: false, error: { message: 'boom\nsecond' } },
      },
      { type: 'tool.execution_complete', data: { toolCallId: 'c2', success: true } },
      { type: 'assistant.message', data: { content: '#7 ci: red' } },
      { type: 'session.idle', data: {} },
    ];

    it('starts copilot -p per PBI with the default model auto (#220) and non-interactive permissions, logs steps, notices and herdr tokens; stop rules and exit code as for claude', async () => {
      const gh = setup({
        issues: { 7: pbi() },
        effect: 'close-first',
        stream: [...live, ...events],
        events: [
          step(7, 'pr', 'opened #55', PR),
          attention(7, 'pr_opened', 'opened #55'),
          step(7, 'ci', 'red', PR),
          attention(7, 'ci_red', 'red'),
        ],
      });
      const r = await run(gh, ['-Target', '7', '-Harness', 'copilot'], {
        HERDR_ENV: '1',
        HERDR_PANE_ID: 'p7',
      });
      expect(r.status).toBe(0);
      expect(harnessCalls()).toEqual([
        '-p /deliver 7 --unattended --max 1 --model auto --allow-all-tools --allow-all-paths --allow-all-urls --no-ask-user --output-format json',
      ]);
      expect(read('harness-calls.txt')).toContain('herdr_env=[]');
      const lines = read('.agents/deliver-loop.log');
      // assistant text is logged as it is; the step line comes from the event
      expect(lines).toMatch(/\d\d:\d\d:\d\d » #7 pr: opened #55/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d #7 pr: opened #55\n/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d bash ls -la/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d \[subagent\] view src\/a\.ts/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d ✗ boom/);
      expect(read('herdr-calls.txt')).toContain(
        'deliver_step=7/7 ci: red --token deliver_pr=#55 --token deliver_tone=danger',
      );
      if (process.platform === 'darwin') {
        // osascript stub: notifications exist only on macOS
        expect(read('notices.txt')).toContain('#7 PR opened');
        expect(read('notices.txt')).toContain('#7 CI red');
      }
      expect(r.stdout).toContain('loop result: done');
      expect(fs.existsSync(path.join(cwd, '.agents/deliver-loop.ansi.log'))).toBe(false);
    });
  });

  describe('stop rules', () => {
    it('-Milestone without open issues but a closed PBI labeled needs-decision ends blocked, not done (#235)', async () => {
      const gh = setup({
        issues: { 10: pbi({ state: 'CLOSED', labels: ['pbi', 'needs-decision'] }) },
        milestones: { M4: [10] },
      });
      const r = await run(gh, ['-Milestone', 'M4']);
      expect(r.status).toBe(2);
      expect(r.stdout).toContain('loop result: blocked');
      expect(harnessCalls()).toEqual([]);
    });

    it('-Milestone skips a PBI below a Feature of the milestone that has no or another milestone, and counts the same set (#327)', async () => {
      const gh = setup({
        issues: {
          20: { labels: ['feature'], children: [21, 22, 23] },
          21: pbi({ milestone: 'M4' }),
          22: pbi(),
          23: pbi({ milestone: 'M5' }),
        },
        milestones: { M4: [20] },
        effect: 'close-first',
      });
      const r = await run(gh, ['-Milestone', 'M4']);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('#22 select: outside M4 (milestone: none), skipped');
      expect(r.stdout).toContain('#23 select: outside M4 (milestone: M5), skipped');
      expect(r.stdout).not.toContain('#21 select: outside');
      // 21 is delivered, then nothing is left: done, not "no progress"
      expect(r.stdout).toContain('loop result: done');
      expect(harnessCalls()).toHaveLength(1);
    });

    it('/deliver <feature> without -Milestone still takes its PBIs without a milestone (#327)', async () => {
      const gh = setup({
        issues: { 20: { labels: ['feature'], children: [22] }, 22: pbi() },
        effect: 'close-first',
      });
      const r = await run(gh, ['20']);
      expect(r.stdout).not.toContain('outside');
      expect(r.stdout).toContain('loop result: done');
    });

    it('-Milestone: an open release-test issue as the last item is not delivered and ends the loop done, not blocked (#377)', async () => {
      const gh = setup({
        issues: {
          10: { labels: ['bug'] },
          11: { labels: ['pbi', 'interactive', 'release-test'] },
        },
        milestones: { M4: [10, 11] },
        effect: 'close-first',
      });
      const r = await run(gh, ['-Milestone', 'M4']);
      expect(r.stdout + r.stderr).toContain('loop result: done');
      expect(r.status).toBe(0);
      const st = JSON.parse(read('state.json')).issues;
      expect(st[10].state).toBe('CLOSED');
      expect(st[11].state ?? 'OPEN').toBe('OPEN');
    });

    it('an explicitly passed release-test Target is dropped, never delivered, and the loop ends done (#377)', async () => {
      const gh = setup({
        issues: { 11: { labels: ['pbi', 'interactive', 'release-test'] } },
        effect: 'close-first',
      });
      const r = await run(gh, ['11']);
      expect(r.stdout + r.stderr).toContain('loop result: done');
      expect(r.status).toBe(0);
      expect(harnessCalls()).toEqual([]);
      expect(JSON.parse(read('state.json')).issues[11].state ?? 'OPEN').toBe('OPEN');
    });

    it('-Milestone selects a bug like a PBI, delivers it in one fresh process, ends done when no open and no paused issue is left, reads the milestone M4 with one batched REST call (#103, #127, #235)', async () => {
      const gh = setup({
        issues: {
          10: {
            labels: ['bug'],
            blockers: [{ number: 5, state: 'closed' }],
            body: '## Summary\n\nTier: fast — one-line fix\n', // #325: the model of the tier (haiku)
          },
        },
        milestones: { 'M4 (0.2.0)': [10] }, // a closed milestone renamed 'M<n> (x.y.z)' is still found by M4
        effect: 'close-first',
      });
      const r = await run(gh, ['-Milestone', 'M4'], { HERDR_PANE_ID: 'w1:p5' });
      expect(r.status).toBe(0);
      // outside herdr (#12): no pane is attempted, no display is set and no error is printed; no queue file
      expect(r.stderr).toBe('');
      expect(read('herdr-calls.txt')).toBe('');
      expect(
        fs
          .readdirSync(cwd, { recursive: true })
          .map(String)
          .filter((f) => /queue/i.test(f)),
      ).toEqual([]);
      expect(harnessCalls()).toEqual([
        '-p /deliver --milestone M4 --unattended --max 1 --model haiku --permission-mode auto --output-format stream-json --verbose',
      ]);
      expect(JSON.parse(read('state.json')).issues[10].state).toBe('CLOSED');
      expect(r.stdout).toContain('loop result: done');
      // redirected stdout stays plain text
      expect(r.stdout).not.toContain(String.fromCharCode(27));
      const paths = gh.calls().map((c) => c.args.join(' '));
      expect(paths.filter((c) => c.includes('/issues?milestone='))).toHaveLength(5); // the state read before and after the one iteration; the closed list is read once for the done check; the status block (state=all) before and after (#329)
      expect(
        paths.filter((c) => c.includes('issues?milestone=1&state=open&per_page=100 --paginate')),
      ).toHaveLength(2);
      expect(paths.filter((c) => /^issue /.test(c))).toEqual([]);
      // one REST read of the picked PBI's body per iteration, for its tier (#325)
      expect(paths.filter((c) => /issues\/\d+$/.test(c))).toEqual([
        'api repos/{owner}/{repo}/issues/10',
      ]);
    });

    it('expands a Feature to its open PBIs, passes -Model on, and stops with "no progress" and the last log lines when a PBI stays open', async () => {
      const gh = setup({
        issues: {
          100: { labels: ['feature'], children: [101, 102, 103] },
          101: pbi(),
          102: pbi(),
          103: pbi({ state: 'CLOSED' }),
        },
        effect: 'none',
        stream: [
          { type: 'assistant', message: { content: [{ type: 'text', text: 'working on it' }] } },
        ],
      });
      const r = await run(gh, ['-Target', '100', '-Model', 'opus']);
      expect(r.status).toBe(1);
      expect(harnessCalls()).toEqual([
        '-p /deliver 100 --unattended --max 1 --model opus --permission-mode auto --output-format stream-json --verbose',
      ]);
      expect(r.stdout).toContain('no progress');
      expect(r.stdout).toMatch(/ {2}\d\d:\d\d:\d\d » working on it/);
    });
  });

  describe('model per tier (#325)', () => {
    const modelOf = () =>
      harnessCalls()
        .find((c) => c.includes('--model'))
        ?.match(/--model (\S+)/)?.[1];
    const body = (line: string) => `## Summary\n\n${line}\n\n## Acceptance criteria\n- [ ] x\n`;

    // the Tier line -> haiku is asserted in the milestone case above; the -Model override in the Feature case
    it('takes the model from the size when there is no Tier line', async () => {
      const size = setup({ issues: { 61: pbi({ body: body('Size: L') }) }, effect: 'close-first' });
      const s = await run(size, ['-Target', '61']);
      expect(s.status).toBe(0);
      expect(s.stdout).toContain('#61 tier strong (size L) → model opus');
      expect(modelOf()).toBe('opus');
    });
  });

  describe('progress for a control session (#321)', () => {
    it('writes progress.jsonl (start, iteration-start, iteration-end, result) and latest.txt', async () => {
      const gh = setup({
        issues: { 31: pbi(), 32: pbi() },
        effect: 'close-first',
      });
      const r = await run(gh, ['-Target', '31,32']);
      expect(r.status).toBe(0);
      const latest = read('.agents/deliver-loop/latest.txt').trim();
      expect(fs.realpathSync(latest)).toBe(
        fs.realpathSync(path.dirname(path.join(latest, 'progress.jsonl'))),
      );
      const recs = fs
        .readFileSync(path.join(latest, 'progress.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l));
      expect(recs.map((x) => x.event)).toEqual([
        'start',
        'iteration-start',
        'iteration-end',
        'iteration-start',
        'iteration-end',
        'result',
      ]);
      expect(recs[0]).toMatchObject({ targets: [31, 32], open: 2 });
      expect(recs[2]).toMatchObject({ pbi: 31, delivered: '31', open: 1 });
      expect(recs[5]).toMatchObject({ result: 'done', code: 0, iterations: 2, open: 0 });
    });

    it('records a held PBI as result blocked', async () => {
      const gh = setup({ issues: { 41: pbi({ labels: ['pbi', 'needs-decision'] }) } });
      const r = await run(gh, ['-Target', '41']);
      expect(r.status).toBe(2);
      const latest = read('.agents/deliver-loop/latest.txt').trim();
      const last = fs
        .readFileSync(path.join(latest, 'progress.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((l) => JSON.parse(l))
        .pop();
      expect(last).toMatchObject({ event: 'result', result: 'blocked', code: 2 });
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
      {
        type: 'assistant',
        message: { content: [{ type: 'text', text: `#401 review: ${'x'.repeat(90)}` }] },
      },
      { type: 'assistant', message: { content: [{ type: 'text', text: '#401 ci: red' }] } },
      { type: 'assistant', message: { content: [{ type: 'text', text: '#401 merged: squash' }] } },
    ];

    it('logs one line per step with the agent prefix, tool errors, writes every record to the jsonl and owns the herdr display: harness runs without HERDR_ENV, pane tokens per progress line through the sink, cleared at the end (#16, #372)', async () => {
      // 401 is paused by the run (needs-decision) and counts as progress; 402 (open blocker), 403 (needs-refinement) and
      // 404 (interactive) stay behind, so the loop ends blocked
      const gh = setup({
        issues: {
          401: pbi(),
          402: pbi({ blockers: [{ number: 5, state: 'open' }] }),
          403: pbi({ labels: ['pbi', 'needs-refinement'] }),
          404: pbi({ labels: ['pbi', 'interactive'] }),
        },
        effect: 'hold-first',
        stream,
        events: [
          step(401, 'pr', 'opened #55', PR),
          attention(401, 'pr_opened', 'opened #55'),
          step(401, 'review', 'x'.repeat(90), PR),
          step(401, 'ci', 'red', PR),
          attention(401, 'ci_red', 'red'),
          step(401, 'merged', 'squash', PR),
        ],
      });
      const r = await run(gh, ['-Target', '401,402,403,404'], {
        HERDR_ENV: '1',
        HERDR_PANE_ID: 'p7',
        DELIVER_LOOP_ASSUME_TTY: '1',
      });
      expect(harnessCalls()).toHaveLength(1);
      expect(r.status).toBe(2);
      expect(r.stdout).toContain('loop result: blocked');
      const lines = read('.agents/deliver-loop.log');
      expect(lines).toMatch(/\d\d:\d\d:\d\d » #401 pr: opened #55/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d Agent Review PBI #401 diff/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d \[Review PBI #401 diff\] Bash git diff/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d Read src\/a\.ts/);
      expect(lines).toMatch(/\d\d:\d\d:\d\d ✗ boom/);
      // stdout is a terminal (DELIVER_LOOP_ASSUME_TTY): the colored line
      const ESC = String.fromCharCode(27);
      expect(r.stdout).toContain(`[Review PBI #401 diff] ${ESC}[36mBash${ESC}[0m git diff`);
      const runDirs = fs
        .readdirSync(path.join(cwd, '.agents/deliver-loop'))
        .filter((d) => d !== 'latest.txt');
      expect(runDirs).toHaveLength(1);
      const jsonl = fs
        .readFileSync(path.join(cwd, '.agents/deliver-loop', runDirs[0], '401.jsonl'), 'utf8')
        .trim()
        .split('\n');
      expect(jsonl.map((l) => JSON.parse(l))).toEqual(stream);
      expect(read('harness-calls.txt')).toContain('herdr_env=[]');
      const calls = read('herdr-calls.txt')
        .trim()
        .split('\n')
        .filter((l) => l.includes('report-metadata'));
      // #372: the terminal sink of Report-Progress sets the tokens per step.finished: deliver step n/7 and the tone
      const p =
        'pane report-metadata p7 --source deliver --token deliver=#401 --token deliver_step=';
      const pr = '--token deliver_pr=#55';
      const ttl = '--ttl-ms 3600000';
      expect(calls).toEqual([
        `${p}6/7 pr: opened #55 ${pr} --token deliver_tone=success ${ttl}`,
        // the PR token stays for later steps; the step value is cut at 80 characters
        `${p}4/7 review: ${'x'.repeat(68)} ${pr} --token deliver_tone=neutral ${ttl}`,
        `${p}7/7 ci: red ${pr} --token deliver_tone=danger ${ttl}`,
        `${p}7/7 merged: squash ${pr} --token deliver_tone=success ${ttl}`,
        'pane report-metadata p7 --source deliver --clear-token deliver --clear-token deliver_step --clear-token deliver_pr --clear-token deliver_progress --clear-token deliver_tone',
      ]);
      expect(calls.join('\n')).not.toContain('display-agent');
      // no -LogPane: opens no pane (a TTY and a herdr pane are present); the plain log has no escape codes, stdout is colored and no .ansi.log exists
      expect(read('herdr-calls.txt')).not.toContain('pane list');
      expect(lines).not.toContain(ESC);
      const ansi = r.stdout;
      expect(fs.existsSync(path.join(cwd, '.agents/deliver-loop.ansi.log'))).toBe(false);
      expect(ansi).toMatch(new RegExp(`${ESC}\\[2m\\d\\d:\\d\\d:\\d\\d${ESC}\\[0m `));
      expect(ansi).toContain(`${ESC}[36mRead${ESC}[0m src/a.ts`);
      expect(ansi).toContain(`${ESC}[31m✗ boom${ESC}[0m`);
      // step lines are colored by the tone of the event; assistant text is logged uncolored
      expect(ansi).toContain(`${ESC}[31m#401 ci: red${ESC}[0m`);
      expect(ansi).toContain(`${ESC}[32m#401 merged: squash${ESC}[0m`);
      expect(ansi).toContain(`${ESC}[32m#401 pr: opened #55${ESC}[0m`);
      expect(ansi).toContain(`${ESC}[0m » #401 ci: red`);
      if (process.platform === 'darwin') {
        // osascript stub: attention step and loop result
        const notes = read('notices.txt');
        expect(notes).toContain('#401 PR opened');
        expect(notes).toContain('#401 CI red');
        expect(notes).toContain('loop result: blocked');
      }
    });
  });
});
