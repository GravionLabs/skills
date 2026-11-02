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
      .filter((l) => l && !/^pane (report-metadata|report-agent|release-agent)/.test(l));
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
      expect((await go(gh, ['-NoPane'], herdrEnv)).status).toBe(0);
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
});
