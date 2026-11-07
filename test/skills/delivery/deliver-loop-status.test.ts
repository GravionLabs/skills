import Ajv from 'ajv/dist/2020';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #329: Invoke-DeliverLoop.ps1 prints a progress line, writes .agents/deliver-loop/status.json (schema) and reports
// deliver_progress to the terminal backend (herdr, poimen); gh, claude, herdr, poimen-server are stubs on PATH.
// Own file: deliver-loop.test.ts is at its time budget.
const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1');
const schema = JSON.parse(
  fs.readFileSync(
    path.join(ROOT, 'skills/delivery/deliver/schema/deliver-loop-status.schema.json'),
    'utf8',
  ),
);
const validate = new Ajv({ allErrors: true }).compile(schema);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const BASE = 'https://github.com/acme/app';

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 progress and status.json',
  () => {
    let dir: string;
    let cwd: string;
    let seq = 0;
    let worker: PwshWorker;

    beforeAll(() => {
      dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loop-status-')));
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(() => {
      worker.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    // milestone M4: #5 closed, #10 open (the claude stub closes it); with blocked: #11 open, blocked by the open #12
    const setup = (opts: { text?: string; backendFails?: boolean; blocked?: boolean } = {}) => {
      cwd = path.join(dir, `case-${++seq}`);
      fs.mkdirSync(cwd, { recursive: true });
      const state = path.join(cwd, 'state.json');
      const issues: Record<string, any> = {
        5: { state: 'closed', title: 'done before' },
        10: { state: 'open', title: 'the work' },
      };
      if (opts.blocked) {
        issues[11] = { state: 'open', title: 'waits', blocker: 12 };
        issues[12] = { state: 'open', title: 'blocker', labels: ['needs-decision', 'pbi'] };
      }
      fs.writeFileSync(state, JSON.stringify({ issues }));
      const gh = createFakeGh(
        cwd,
        `(call) => {
        const fs = require('fs');
        const s = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
        const a = call.args[1] || '';
        const row = (n) => ({ number: Number(n), title: s.issues[n].title, state: s.issues[n].state, closed_at: null, body: '',
          labels: (s.issues[n].labels || ['pbi']).map((name) => ({ name })), assignees: [], issue_dependencies_summary: { blocked_by: s.issues[n].blocker ? 1 : 0 } });
        if (/\\/milestones\\?/.test(a)) return { rest: [[{ number: 4, title: 'M4 Status', state: 'open', html_url: '${BASE}/milestone/4' }]] };
        let m = /issues\\?milestone=4&state=(open|closed|all)/.exec(a);
        if (m) return { rest: [Object.keys(s.issues).filter((n) => m[1] === 'all' || s.issues[n].state === m[1]).map(row)] };
        m = /issues\\/(\\d+)\\/dependencies\\/blocked_by/.exec(a);
        if (m) { const b = s.issues[m[1]].blocker; return { rest: [b ? [{ number: b, state: 'open', repository_url: 'x' }] : []] }; }
        m = /^repos\\/\\{owner\\}\\/\\{repo\\}\\/issues\\/(\\d+)$/.exec(a);
        if (m) return { rest: { number: Number(m[1]), body: '', state: s.issues[m[1]].state, labels: (s.issues[m[1]].labels || ['pbi']).map((name) => ({ name })), milestone: { title: 'M4 Status' } } };
        throw new Error('unexpected gh ' + call.args.join(' '));
      }`,
      );
      fs.writeFileSync(
        path.join(cwd, 'effect.js'),
        `const fs = require('fs'); const f = ${JSON.stringify(state)};
const s = JSON.parse(fs.readFileSync(f, 'utf8')); s.issues[10].state = 'closed'; fs.writeFileSync(f, JSON.stringify(s));`,
      );
      const text = opts.text ?? '#10 review: clean';
      fs.writeFileSync(
        path.join(cwd, 'stream.jsonl'),
        JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text }] } }) +
          '\n',
      );
      const stub = (name: string, body: string) =>
        fs.writeFileSync(path.join(gh.bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
      stub('claude', `cat ${cwd}/stream.jsonl\nnode ${cwd}/effect.js`);
      stub('herdr', `echo "$*" >> ${cwd}/herdr-calls.txt`);
      stub(
        'poimen-server',
        `echo "$*" >> ${cwd}/poimen-calls.txt${opts.backendFails ? '\nexit 1' : ''}`,
      );
      stub('osascript', 'true');
      return gh;
    };
    const run = (gh: ReturnType<typeof createFakeGh>, env: NodeJS.ProcessEnv = {}) =>
      worker.run(['-Milestone', 'M4', '-Model', 'sonnet'], {
        cwd,
        env: {
          ...gh.env(),
          HERDR_ENV: '',
          POIMEN_SOCKET: '',
          POIMEN_TERMINAL_ID: '',
          DELIVER_TERMINAL_BACKEND: '',
          NO_COLOR: '1',
          ...env,
        },
      });
    const lines = (f: string) => {
      const p = path.join(cwd, f);
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n') : [];
    };
    const status = () =>
      JSON.parse(fs.readFileSync(path.join(cwd, '.agents/deliver-loop/status.json'), 'utf8'));

    it('writes a schema-valid status.json atomically and prints the progress line outside herdr and poimen', async () => {
      const r = await run(setup({ blocked: true, text: '#10 pr: opened #55' }));
      expect(r.status).toBe(2);
      expect(r.stdout).toContain('M4 ▓▓░░░░░░ 1/4 · #10 pr');
      expect(r.stdout).toContain('M4 ▓▓▓▓░░░░ 2/4 · 1 blocked · 1 needs you');
      const doc = status();
      expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
      expect(doc).toMatchObject({
        harness: 'claude',
        model: 'sonnet',
        repository: 'acme/app',
        milestone: { key: 'M4', title: 'M4 Status', url: `${BASE}/milestone/4` },
        closed: 2,
        total: 4,
        current: null,
        delivered: [{ pbi: 10, url: `${BASE}/issues/10`, prUrl: `${BASE}/pull/55` }],
        blocked: [
          { number: 11, url: `${BASE}/issues/11`, reason: expect.stringContaining('blocked by') },
        ],
        needsYou: [
          { number: 12, url: `${BASE}/issues/12`, reason: expect.stringContaining('decision') },
        ],
        result: 'blocked',
      });
      expect(
        fs.readdirSync(path.join(cwd, '.agents/deliver-loop')).filter((f) => f.endsWith('.tmp')),
      ).toEqual([]);
      expect(r.stderr).toBe('');
    });

    it('herdr: deliver_progress joins the tokens and is cleared on exit', async () => {
      const r = await run(setup(), { HERDR_ENV: '1', HERDR_PANE_ID: 'p7' });
      expect(r.status).toBe(0);
      const calls = lines('herdr-calls.txt').filter((l) => /report-metadata/.test(l));
      expect(calls.some((l) => l.includes('--token deliver_progress=1/2'))).toBe(true);
      expect(calls.at(-1)).toContain('--clear-token deliver_progress');
      expect(lines('poimen-calls.txt')).toEqual([]);
      expect(status().result).toBe('done');
    });

    it('poimen: the same tokens and the lifecycle state go through poimen-server, a failing server does not stop the loop', async () => {
      const r = await run(setup({ backendFails: true }), {
        POIMEN_SOCKET: '/s',
        POIMEN_TERMINAL_ID: 't1',
      });
      expect(r.status).toBe(0);
      const calls = lines('poimen-calls.txt');
      expect(
        calls.some(
          (l) =>
            l.startsWith('report tokens --source deliver --ttl 3600 ') &&
            l.includes(' deliver=#10'),
        ),
      ).toBe(true);
      // #372: the sink reports deliver_progress with milestone.progress, the step tokens with step.finished
      expect(calls.some((l) => l.includes(' deliver_step='))).toBe(true);
      expect(calls.some((l) => l.includes(' deliver_progress=1/2'))).toBe(true);
      expect(calls.some((l) => l.startsWith('report agent --state working'))).toBe(true);
      expect(calls).toContain('report clear --source deliver');
      expect(calls.some((l) => l.includes('--token') || l.includes('--ttl-ms'))).toBe(false);
      expect(lines('herdr-calls.txt')).toEqual([]);
      expect(status().result).toBe('done');
    });
  },
);

// The adapter alone: a failing or missing poimen-server warns once per run (stderr), calls return normally.
describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'TerminalBackend.ps1 poimen warning',
  () => {
    const backend = path.join(ROOT, 'skills/delivery/deliver/scripts/TerminalBackend.ps1');
    const call = (bin: string) =>
      spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-Command',
          `. '${backend}'; foreach ($i in 1..3) { Set-LoopTokens -Token @{ deliver = '#1'; deliver_progress = '1/2' } -Backend poimen }; Set-LoopAgentState -State idle -Backend poimen; 'ok'`,
        ],
        {
          encoding: 'utf8',
          env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
        },
      );

    it.each([
      ['exits 1', '#!/bin/sh\nexit 1\n'],
      ['is missing', null],
    ])('poimen-server %s: one warning, the call returns', (_n, body) => {
      const bin = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'poimen-warn-')));
      try {
        if (body) fs.writeFileSync(path.join(bin, 'poimen-server'), body, { mode: 0o755 });
        const r = call(bin);
        expect(r.stdout.trim()).toBe('ok');
        expect(r.stderr.match(/poimen-server/g)).toHaveLength(1);
      } finally {
        fs.rmSync(bin, { recursive: true, force: true });
      }
    });
  },
);
