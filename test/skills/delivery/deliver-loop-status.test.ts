import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { reportEventCmd } from '../../helpers/report-progress';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #329: Invoke-DeliverLoop.ps1 prints a progress line and reports
// no status.json and no calls to the terminal backend (herdr, poimen); gh, claude, herdr, poimen-server are stubs on PATH.
// Own file: deliver-loop.test.ts is at its time budget.
const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const BASE = 'https://github.com/acme/app';

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 progress and terminal tokens',
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
    const setup = (opts: { event?: string[]; backendFails?: boolean; blocked?: boolean } = {}) => {
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
      const event = opts.event ?? [
        '-Type',
        'step.finished',
        '-Issue',
        '10',
        '-Step',
        'review',
        '-Result',
        'clean',
      ];
      fs.writeFileSync(
        path.join(cwd, 'stream.jsonl'),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'working' }] },
        }) + '\n',
      );
      const stub = (name: string, body: string) =>
        fs.writeFileSync(path.join(gh.bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
      stub('claude', `cat ${cwd}/stream.jsonl\n${reportEventCmd(event)}\nnode ${cwd}/effect.js`);
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
    const noStatusFile = () =>
      expect(fs.existsSync(path.join(cwd, '.agents/deliver-loop/status.json'))).toBe(false);

    it('prints the progress line and writes no status.json outside herdr and poimen', async () => {
      const r = await run(
        setup({
          blocked: true,
          event: [
            '-Type',
            'step.finished',
            '-Issue',
            '10',
            '-Step',
            'pr',
            '-Result',
            'opened #55',
            '-Pr',
            `${BASE}/pull/55`,
          ],
        }),
      );
      expect(r.status).toBe(2);
      expect(r.stdout).toContain('M4 ▓▓░░░░░░ 1/4 · #10 pr');
      expect(r.stdout).toContain('M4 ▓▓▓▓░░░░ 2/4 · 1 blocked · 1 needs you');
      noStatusFile();
      expect(r.stderr).toBe('');
    });

    it('herdr and poimen: the loop calls neither backend for tokens or agent state (#417)', async () => {
      const h = await run(setup(), { HERDR_ENV: '1', HERDR_PANE_ID: 'p7' });
      expect(h.status).toBe(0);
      expect(lines('herdr-calls.txt')).toEqual([]);
      const p = await run(setup(), { POIMEN_SOCKET: '/s', POIMEN_TERMINAL_ID: 't1' });
      expect(p.status).toBe(0);
      expect(lines('poimen-calls.txt')).toEqual([]);
      noStatusFile();
    });
  },
);
