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
const ESC = String.fromCharCode(27);

// #193: colored stdout and the opt-in herdr log pane of Invoke-DeliverLoop.ps1. PBI 401 is closed, so every run is
// done at once (no harness). gh and herdr are stubs on PATH; herdr answers `pane list` from herdr-list.json.
describe.skipIf(!hasPwsh || process.platform === 'win32')('Invoke-DeliverLoop.ps1 console', () => {
  let dir: string;
  let cwd: string;
  let seq = 0;
  let worker: PwshWorker;

  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deliver-loop-console-')));
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const prepare = (list: object[] = [{ pane_id: 'w1:p5', tab_id: 'w1:t5', label: 'skills' }]) => {
    cwd = path.join(dir, `case-${++seq}`);
    fs.mkdirSync(cwd, { recursive: true });
    const gh = createFakeGh(
      cwd,
      `(call) => {
        if (/^repos\\/\\{owner\\}\\/\\{repo\\}\\/issues\\/401$/.test(call.args[1] || '')) {
          return { rest: { number: 401, state: 'closed', labels: [{ name: 'pbi' }] } };
        }
        throw new Error('unexpected gh ' + call.args.join(' '));
      }`,
    );
    fs.writeFileSync(
      path.join(cwd, 'herdr-list.json'),
      JSON.stringify({ id: 'cli:pane:list', result: { panes: list, type: 'pane_list' } }),
    );
    fs.writeFileSync(
      path.join(gh.bin, 'herdr'),
      `#!/bin/sh
echo "$*" >> ${cwd}/herdr-calls.txt
case "$1 $2" in
  "pane list") cat ${cwd}/herdr-list.json ;;
  "pane split") echo '{"id":"cli:pane:split","result":{"pane":{"pane_id":"w1:p9"}}}' ;;
esac
`,
      { mode: 0o755 },
    );
    return gh;
  };
  const read = (f: string) => {
    const p = path.join(cwd, f);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
  };
  const go = (gh: ReturnType<typeof createFakeGh>, args: string[], env: NodeJS.ProcessEnv = {}) =>
    worker.run(['-Target', '401', ...args], {
      cwd,
      env: { ...gh.env(), HERDR_ENV: '', NO_COLOR: '', DELIVER_LOOP_ASSUME_TTY: '', ...env },
    });
  const paneCalls = () =>
    read('herdr-calls.txt')
      .split('\n')
      .filter((l) => l && !/^pane (report-metadata|report-agent|release-agent|get)/.test(l));
  const herdrEnv = { HERDR_ENV: '1', HERDR_PANE_ID: 'w1:p5', DELIVER_LOOP_ASSUME_TTY: '1' };

  describe('stdout colors', () => {
    it('is colored like the ANSI log on a terminal; the plain log stays free of escapes', async () => {
      const r = await go(prepare(), [], { DELIVER_LOOP_ASSUME_TTY: '1' });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(new RegExp(`${ESC}\\[2m\\d\\d:\\d\\d:\\d\\d${ESC}\\[0m `));
      expect(r.stdout).toContain(`${ESC}[32mloop result: done`);
      expect(read('.agents/deliver-loop.log')).not.toContain(ESC);
      expect(read('.agents/deliver-loop.ansi.log')).toContain(`${ESC}[32mloop result: done`);
    });

    it.each([
      ['redirected stdout (no terminal)', [], {}],
      ['-NoColor', ['-NoColor'], { DELIVER_LOOP_ASSUME_TTY: '1' }],
      ['NO_COLOR', [], { NO_COLOR: '1', DELIVER_LOOP_ASSUME_TTY: '1' }],
    ])('stays plain: %s', async (_name, args, env) => {
      const r = await go(prepare(), args as string[], env);
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/\d\d:\d\d:\d\d loop result: done/);
      expect(r.stdout).not.toContain(ESC);
    });
  });

  describe('log pane', () => {
    it('opens no pane by default, also with -NoPane (deprecated no-op), although herdr and a terminal are present', async () => {
      const gh = prepare();
      expect((await go(gh, [], herdrEnv)).status).toBe(0);
      expect(paneCalls()).toEqual([]);
      // own process: the worker does not capture [Console]::Error
      const np = spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, '-Target', '401', '-NoPane'], {
        cwd,
        encoding: 'utf8',
        env: { ...gh.env(), HERDR_ENV: '', NO_COLOR: '', DELIVER_LOOP_ASSUME_TTY: '' },
      });
      expect(np.status).toBe(0);
      expect(np.stderr).toContain('-NoPane is deprecated');
      expect(paneCalls()).toEqual([]);
    });

    it('-LogPane opens one pane below that tails the ANSI log, labels it deliver-log and leaves it open', async () => {
      // a deliver-log pane of another tab does not count
      const gh = prepare([
        { pane_id: 'w1:p5', tab_id: 'w1:t5', label: 'skills' },
        { pane_id: 'w2:p1', tab_id: 'w2:t1', label: 'deliver-log' },
      ]);
      const r = await go(gh, ['-LogPane'], herdrEnv);
      expect(r.status).toBe(0);
      expect(r.stderr).toBe('');
      expect(paneCalls()).toEqual([
        'pane list',
        'pane split --current --direction down --ratio 0.7 --no-focus',
        `pane run w1:p9 pwsh -NoProfile -Command "Get-Content -Tail 40 -Wait '${path.join(cwd, '.agents/deliver-loop.ansi.log')}'"`,
        'pane rename w1:p9 deliver-log',
      ]);
    });

    it('-LogPane reuses a deliver-log pane of the tab; with NO_COLOR it tails the plain log', async () => {
      const gh = prepare([
        { pane_id: 'w1:p5', tab_id: 'w1:t5', label: 'skills' },
        { pane_id: 'w1:p6', tab_id: 'w1:t5', label: 'deliver-log' },
      ]);
      await go(gh, ['-LogPane'], herdrEnv);
      expect(paneCalls()).toEqual(['pane list']);
      const plain = prepare();
      await go(plain, ['-LogPane'], { ...herdrEnv, NO_COLOR: '1' });
      expect(paneCalls()).toContain(
        `pane run w1:p9 pwsh -NoProfile -Command "Get-Content -Tail 40 -Wait '${path.join(cwd, '.agents/deliver-loop.log')}'"`,
      );
    });

    it('-LogPane opens no pane when stdout is not a terminal', async () => {
      await go(prepare(), ['-LogPane'], { ...herdrEnv, DELIVER_LOOP_ASSUME_TTY: '' });
      expect(paneCalls()).toEqual([]);
    });
  });

  // Lines, colors and notifications come from the events the harness writes (tone, attention, issue.finished); the stream's
  // assistant text is logged uncolored and never parsed. The claude stub appends raw events to the loop's run and closes #401.
  describe('events', () => {
    type Ev = Record<string, unknown>;
    const ev = (type: string, tone: string, extra: Ev = {}): Ev => ({
      v: 1,
      type,
      tone,
      issue: { number: 401 },
      ...extra,
    });
    const stepEv = (name: string, text: string, tone: string) =>
      ev('step.finished', tone, { step: { name, text } });
    const attention = (kind: string, tone: string) =>
      ev('attention', tone, { kind, reason: 'why' });

    const open = (events: Ev[], text = 'working') => {
      cwd = path.join(dir, `case-${++seq}`);
      fs.mkdirSync(cwd, { recursive: true });
      const state = path.join(cwd, 'state.json');
      fs.writeFileSync(state, JSON.stringify({ state: 'open' }));
      const gh = createFakeGh(
        cwd,
        `(call) => {
          if (/^repos\\/\\{owner\\}\\/\\{repo\\}\\/issues\\/401$/.test(call.args[1] || '')) {
            const s = JSON.parse(require('fs').readFileSync(${JSON.stringify(state)}, 'utf8'));
            return { rest: { number: 401, state: s.state, labels: [{ name: 'pbi' }] } };
          }
          if (/sub_issues|blocked_by/.test(call.args[1] || '')) return { rest: [] };
          throw new Error('unexpected gh ' + call.args.join(' '));
        }`,
      );
      fs.writeFileSync(
        path.join(cwd, 'harness.js'),
        `const fs = require('fs'); const path = require('path'); const env = process.env;
const file = path.join(env.AGENT_EVENTS_DIR, env.AGENT_EVENTS_RUN + '.jsonl');
for (const e of ${JSON.stringify(events)}) fs.appendFileSync(file, JSON.stringify({ ...e, ts: new Date().toISOString(), run: env.AGENT_EVENTS_RUN }) + '\\n');
console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: ${JSON.stringify(text)} }] } }));
fs.writeFileSync(${JSON.stringify(state)}, JSON.stringify({ state: 'closed' }));`,
      );
      const stub = (name: string, body: string) =>
        fs.writeFileSync(path.join(gh.bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
      stub('claude', `node ${cwd}/harness.js`);
      stub('osascript', `echo "$*" >> ${cwd}/notices.txt`);
      stub('herdr', 'true');
      return gh;
    };
    const tty = { DELIVER_LOOP_ASSUME_TTY: '1' };

    it('colors a step line by the tone of its event, neutral stays uncolored', async () => {
      const gh = open([
        stepEv('pr', 'opened #55', 'success'),
        stepEv('select', 'ready', 'info'),
        stepEv('review', 'fix 1/2', 'warning'),
        stepEv('ci', 'red', 'danger'),
        stepEv('implement', 'started', 'neutral'),
      ]);
      const r = await worker.run(['-Target', '401', '-Model', 'sonnet'], {
        cwd,
        env: { ...gh.env(), HERDR_ENV: '', NO_COLOR: '', ...tty },
      });
      expect(r.status).toBe(0);
      const ansi = read('.agents/deliver-loop.ansi.log');
      expect(ansi).toContain(`${ESC}[32m#401 pr: opened #55${ESC}[0m`);
      expect(ansi).toContain(`${ESC}[36m#401 select: ready${ESC}[0m`);
      expect(ansi).toContain(`${ESC}[33m#401 review: fix 1/2${ESC}[0m`);
      expect(ansi).toContain(`${ESC}[31m#401 ci: red${ESC}[0m`);
      expect(ansi).toMatch(new RegExp(`${ESC}\\[0m #401 implement: started\\n`));
      expect(read('.agents/deliver-loop.log')).toMatch(/\d\d:\d\d:\d\d #401 ci: red\n/);
      expect(read('.agents/deliver-loop.log')).not.toContain(ESC);
      expect(r.stdout).toContain(`${ESC}[31m#401 ci: red`);
    });

    it('stays plain with -NoColor but still writes the step lines', async () => {
      const gh = open([stepEv('ci', 'red', 'danger')]);
      const r = await worker.run(['-Target', '401', '-Model', 'sonnet', '-NoColor'], {
        cwd,
        env: { ...gh.env(), HERDR_ENV: '', NO_COLOR: '', ...tty },
      });
      expect(r.status).toBe(0);
      expect(r.stdout).toMatch(/\d\d:\d\d:\d\d #401 ci: red/);
      expect(r.stdout).not.toContain(ESC);
      expect(read('.agents/deliver-loop.ansi.log')).toBe('');
    });

    it.skipIf(process.platform !== 'darwin')(
      'notifies per attention kind and delivered issue, with the urgency from the tone',
      async () => {
        const gh = open([
          attention('pr_opened', 'success'),
          attention('review_fix', 'warning'),
          attention('ci_red', 'danger'),
          attention('paused', 'warning'),
          attention('blocked', 'danger'),
          attention('needs_you', 'warning'),
          ev('issue.finished', 'success', { outcome: 'delivered' }),
        ]);
        await worker.run(['-Target', '401', '-Model', 'sonnet'], {
          cwd,
          env: { ...gh.env(), HERDR_ENV: '', NO_COLOR: '' },
        });
        const notes = read('notices.txt').trim().split('\n');
        expect(notes).toHaveLength(7);
        expect(notes[0]).toContain('#401 PR opened');
        expect(notes[0]).not.toContain('sound name');
        expect(notes[1]).toContain('#401 review fix round');
        expect(notes[1]).toContain('sound name "Ping"');
        expect(notes[2]).toContain('#401 CI red');
        expect(notes[2]).toContain('sound name "Basso"');
        expect(notes[3]).toContain('#401 paused');
        expect(notes[4]).toContain('#401 blocked');
        expect(notes[5]).toContain('#401 merged');
        expect(notes[6]).toContain('loop result: done');
      },
    );

    it('writes no step line from assistant text alone, neither color nor notification', async () => {
      const gh = open([], '#401 pr: opened #55\n#401 ci: red\n#401 paused: x');
      const r = await worker.run(['-Target', '401', '-Model', 'sonnet'], {
        cwd,
        env: { ...gh.env(), HERDR_ENV: '', NO_COLOR: '', ...tty },
      });
      expect(r.status).toBe(0);
      const log = read('.agents/deliver-loop.log');
      expect(log).toContain('» #401 pr: opened #55');
      expect(log).not.toMatch(/\d\d:\d\d:\d\d #401 (pr|ci|paused)/);
      expect(read('.agents/deliver-loop.ansi.log')).not.toContain(`${ESC}[31m`);
      expect(read('.agents/deliver-loop.ansi.log')).not.toContain(`${ESC}[33m`);
      expect(read('notices.txt')).not.toMatch(/PR opened|CI red|paused/);
    });
  });
});
