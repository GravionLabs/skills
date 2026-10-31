import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Switch-LogPane.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// #13: Switch-LogPane.ps1 toggles the deliver-log pane. herdr is a stub on PATH that records its calls, answers
// `pane list` from herdr-list.json and `pane split` with pane w1:p9 (or fails when list-fail exists).
describe.skipIf(!hasPwsh || process.platform === 'win32')('Switch-LogPane.ps1', () => {
  let dir: string;
  let bin: string;
  let cwd: string;
  let seq = 0;
  let worker: PwshWorker;

  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'switch-log-pane-')));
    bin = path.join(dir, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, 'herdr'),
      `#!/bin/sh
echo "$*" >> "$HERDR_STUB_DIR/herdr-calls.txt"
case "$1 $2" in
  "pane list") [ -f "$HERDR_STUB_DIR/list-fail" ] && exit 1; cat "$HERDR_STUB_DIR/herdr-list.json" ;;
  "pane split") echo '{"id":"cli:pane:split","result":{"pane":{"pane_id":"w1:p9"}}}' ;;
esac
`,
      { mode: 0o755 },
    );
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const active = { pane_id: 'w1:p5', tab_id: 'w1:t5', label: 'claude' };
  const logPane = { pane_id: 'w1:p6', tab_id: 'w1:t5', label: 'deliver-log' };
  const otherTab = { pane_id: 'w2:p1', tab_id: 'w2:t1', label: 'deliver-log' };

  // a case directory (the active pane's cwd) with the given pane list and log files
  const prepare = (opts: { panes?: object[]; logs?: string[]; listFails?: boolean } = {}) => {
    cwd = path.join(dir, `case-${++seq}`);
    fs.mkdirSync(path.join(cwd, '.agents'), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, 'herdr-list.json'),
      JSON.stringify({ id: 'cli:pane:list', result: { panes: opts.panes ?? [active] } }),
    );
    for (const log of opts.logs ?? ['deliver-loop.ansi.log', 'deliver-loop.log'])
      fs.writeFileSync(path.join(cwd, '.agents', log), 'line\n');
    if (opts.listFails) fs.writeFileSync(path.join(cwd, 'list-fail'), '');
  };
  const baseEnv = () => {
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}` };
    for (const k of Object.keys(env)) if (k.startsWith('HERDR_')) delete env[k];
    return { ...env, HERDR_STUB_DIR: cwd };
  };
  // shell keybinding: HERDR_ACTIVE_* only, runs from the pane's cwd, no HERDR_ENV
  const shellEnv = () => ({
    ...baseEnv(),
    HERDR_ACTIVE_TAB_ID: 'w1:t5',
    HERDR_ACTIVE_PANE_ID: 'w1:p5',
    HERDR_ACTIVE_PANE_CWD: cwd,
  });
  // plugin action: HERDR_ENV with HERDR_TAB_ID / HERDR_PANE_ID, started elsewhere (cwd is the current directory)
  const pluginEnv = () => ({
    ...baseEnv(),
    HERDR_ENV: '1',
    HERDR_TAB_ID: 'w1:t5',
    HERDR_PANE_ID: 'w1:p5',
  });
  const run = (env: NodeJS.ProcessEnv) => worker.run([], { cwd, env });
  const calls = () => {
    const f = path.join(cwd, 'herdr-calls.txt');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n') : [];
  };
  const opened = (log: string) => [
    'pane list',
    'pane list',
    'pane split w1:p5 --direction down --ratio 0.7 --no-focus',
    `pane run w1:p9 pwsh -NoProfile -Command "Get-Content -Tail 40 -Wait '${path.join(cwd, '.agents', log)}'"`,
    'pane rename w1:p9 deliver-log',
  ];

  it.each([
    ['shell keybinding (HERDR_ACTIVE_*)', shellEnv],
    ['plugin action (HERDR_*)', pluginEnv],
  ])('%s: opens the pane below the active pane on the ANSI log', async (_name, env) => {
    // a deliver-log pane of another tab does not count
    prepare({ panes: [active, otherTab] });
    const r = await run(env());
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(calls()).toEqual(opened('deliver-loop.ansi.log'));
  });

  it.each([
    ['shell keybinding (HERDR_ACTIVE_*)', shellEnv],
    ['plugin action (HERDR_*)', pluginEnv],
  ])('%s: closes the deliver-log pane of the active tab and opens none', async (_name, env) => {
    prepare({ panes: [active, logPane, otherTab] });
    const r = await run(env());
    expect(r.status).toBe(0);
    expect(calls()).toEqual(['pane list', 'pane close w1:p6']);
  });

  it('falls back to the plain log when there is no ANSI log (NO_COLOR run)', async () => {
    prepare({ logs: ['deliver-loop.log'] });
    await run(shellEnv());
    expect(calls()).toEqual(opened('deliver-loop.log'));
  });

  it('no log file: opens no pane, exits 0', async () => {
    prepare({ logs: [] });
    const r = await run(shellEnv());
    expect(r.status).toBe(0);
    expect(calls()).toEqual(['pane list']);
  });

  it('outside herdr: touches no herdr, exits 0', async () => {
    prepare();
    const r = await run(baseEnv());
    expect(r.status).toBe(0);
    expect(r.stderr).toBe('');
    expect(calls()).toEqual([]);
  });

  it('a failing pane list opens no pane, exits 0', async () => {
    prepare({ listFails: true });
    const r = await run(shellEnv());
    expect(r.status).toBe(0);
    expect(calls()).toEqual(['pane list']);
  });

  // own spawn: the message goes to the console's stderr, which the worker does not capture
  it('no log file: says so on stderr', () => {
    prepare({ logs: [] });
    const r = spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT], {
      cwd,
      env: shellEnv(),
      encoding: 'utf8',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('deliver log: no .agents/deliver-loop.log under');
  });
});
