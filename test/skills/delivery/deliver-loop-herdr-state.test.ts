import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #191: Invoke-DeliverLoop.ps1 reports its lifecycle state to herdr (report-agent, release-agent); gh, claude, herdr are stubs on PATH.
// Own file: deliver-loop.test.ts is at its time budget.
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const SRC = 'p7 --source deliver-loop --agent deliver';

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 herdr agent state',
  () => {
    let dir: string;
    let cwd: string;
    let seq = 0;
    let worker: PwshWorker;

    beforeAll(() => {
      dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loop-state-')));
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(() => {
      worker.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    // open: PBI numbers; close: the claude stub closes the first open PBI; text: assistant line it prints
    const setup = (opts: {
      open: number[];
      close?: boolean;
      text?: string;
      herdrFails?: boolean;
      paneAgent?: string;
    }) => {
      cwd = path.join(dir, `case-${++seq}`);
      fs.mkdirSync(cwd, { recursive: true });
      const state = path.join(cwd, 'state.json');
      fs.writeFileSync(
        state,
        JSON.stringify({
          issues: Object.fromEntries(opts.open.map((n) => [n, { state: 'OPEN', labels: ['pbi'] }])),
        }),
      );
      const gh = createFakeGh(
        cwd,
        `(call) => {
        const fs = require('fs');
        const s = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
        const a = call.args;
        let m = /^repos\\/\\{owner\\}\\/\\{repo\\}\\/issues\\/(\\d+)$/.exec(a[1] || '');
        if (a[0] === 'api' && m) {
          const i = s.issues[m[1]];
          if (!i) throw new Error('no issue ' + m[1]);
          return { rest: { number: Number(m[1]), state: i.state.toLowerCase(), labels: i.labels.map((name) => ({ name })) } };
        }
        m = /issues\\/(\\d+)\\/sub_issues/.exec(a[1] || '');
        if (m) return { rest: [] };
        m = /issues\\/(\\d+)\\/dependencies\\/blocked_by/.exec(a[1] || '');
        if (m) return { rest: [] };
        throw new Error('unexpected gh ' + a.join(' '));
      }`,
      );
      fs.writeFileSync(
        path.join(cwd, 'effect.js'),
        `const fs = require('fs'); const f = ${JSON.stringify(state)};
const s = JSON.parse(fs.readFileSync(f, 'utf8'));
if (${opts.close ? 'true' : 'false'}) { const n = Object.keys(s.issues).find((k) => s.issues[k].state === 'OPEN'); s.issues[n].state = 'CLOSED'; }
fs.writeFileSync(f, JSON.stringify(s));`,
      );
      fs.writeFileSync(
        path.join(cwd, 'stream.jsonl'),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: opts.text ?? 'working' }] },
        }) + '\n',
      );
      const stub = (name: string, body: string) =>
        fs.writeFileSync(path.join(gh.bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
      stub('claude', `cat ${cwd}/stream.jsonl\nnode ${cwd}/effect.js`);
      const paneGet = opts.paneAgent
        ? `\n[ "$1 $2" = "pane get" ] && echo '{"result":{"pane":{"pane_id":"p7","agent":"${opts.paneAgent}"}}}'`
        : '';
      stub(
        'herdr',
        `echo "$*" >> ${cwd}/herdr-calls.txt${opts.herdrFails ? '\nexit 1' : ''}${paneGet}`,
      );
      stub('osascript', 'true');
      return gh;
    };
    const calls = () => {
      const p = path.join(cwd, 'herdr-calls.txt');
      return (fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n') : []).filter((l) =>
        /report-agent|release-agent/.test(l),
      );
    };
    const run = (
      gh: ReturnType<typeof createFakeGh>,
      args: string[],
      env: NodeJS.ProcessEnv = {},
    ) =>
      worker.run(args, {
        cwd,
        env: { ...gh.env(), HERDR_ENV: '1', HERDR_PANE_ID: 'p7', NO_COLOR: '', ...env },
      });
    const report = (state: string) =>
      `pane report-agent p7 --state ${state} --source deliver-loop --agent deliver`;
    const release = `pane release-agent ${SRC}`;

    it('reports working per iteration, idle at the end, then releases', async () => {
      const r = await run(setup({ open: [1, 2], close: true }), ['-Target', '1,2']);
      expect(r.status).toBe(0);
      expect(calls()).toEqual([report('working'), report('working'), report('idle'), release]);
    });

    it('reports blocked when the loop ends with no progress and when an iteration pauses', async () => {
      const stuck = await run(setup({ open: [1] }), ['-Target', '1']);
      expect(stuck.status).toBe(1);
      expect(calls()).toEqual([report('working'), report('blocked'), release]);
      const paused = await run(
        setup({ open: [1], close: true, text: '#1 paused: needs a decision' }),
        ['-Target', '1'],
      );
      expect(paused.status).toBe(0);
      // #372: the terminal sink of Report-Progress sets the state: attention paused → blocked, run.finished done → idle
      expect(calls()).toEqual([report('working'), report('blocked'), report('idle'), release]);
    });

    it('reports nothing in a pane with another agent (it would compete) and says so', async () => {
      const r = await run(setup({ open: [1], close: true, paneAgent: 'claude' }), ['-Target', '1']);
      expect(r.status).toBe(0);
      expect(calls()).toEqual([]);
      expect(r.stdout).toContain('another agent runs in this pane');
      const own = await run(setup({ open: [1], close: true, paneAgent: 'deliver' }), [
        '-Target',
        '1',
      ]);
      expect(own.status).toBe(0);
      expect(calls()).toEqual([report('working'), report('idle'), release]);
    });

    it('releases on error, ignores herdr failures and calls nothing outside herdr', async () => {
      const err = await run(setup({ open: [1] }), ['-Target', '1,99']);
      expect(err.status).not.toBe(0);
      // #372: the finally ends the run with run.finished no progress: blocked, then release
      expect(calls()).toEqual([report('blocked'), release]);
      const failing = await run(setup({ open: [1], close: true, herdrFails: true }), [
        '-Target',
        '1',
      ]);
      expect(failing.status).toBe(0);
      expect(calls()).toEqual([report('working'), report('idle'), release]);
      const outside = await run(setup({ open: [1], close: true }), ['-Target', '1'], {
        HERDR_ENV: '',
      });
      expect(outside.status).toBe(0);
      expect(fs.existsSync(path.join(cwd, 'herdr-calls.txt'))).toBe(false);
    });
  },
);
