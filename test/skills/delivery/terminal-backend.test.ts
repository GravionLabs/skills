import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const scripts = path.resolve(__dirname, '../../../skills/delivery/deliver/scripts');
const backend = path.join(scripts, 'TerminalBackend.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// #331: TerminalBackend.ps1 is the only file of the deliver scripts that calls the terminal CLI.
describe.skipIf(!hasPwsh || process.platform === 'win32')('TerminalBackend.ps1', () => {
  let dir: string;
  let bin: string;
  let calls: string;

  const run = (code: string, env: Record<string, string> = {}) =>
    spawnSync('pwsh', ['-NoProfile', '-Command', `. '${backend}'; ${code}`], {
      encoding: 'utf8',
      env: {
        PATH: `${bin}${path.delimiter}${process.env.PATH}`,
        HOME: dir,
        STUB_CALLS: calls,
        ...env,
      },
    });
  const recorded = () =>
    fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8').trim().split('\n') : [];
  const stub = (name: string, body = '') =>
    fs.writeFileSync(
      path.join(bin, name),
      `#!/bin/sh\necho "${name} $*" >> "$STUB_CALLS"\n${body}\n`,
      { mode: 0o755 },
    );

  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'terminal-backend-')));
    bin = path.join(dir, 'bin');
    calls = path.join(dir, 'calls.txt');
    fs.mkdirSync(bin);
  });
  beforeEach(() => {
    fs.rmSync(calls, { force: true });
    stub('herdr');
    stub('poimen-server');
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('selects the backend from the environment, DELIVER_TERMINAL_BACKEND wins', () => {
    const script = `
      foreach ($c in @(
        @{ n = 'poimen'; e = @{ POIMEN_TERMINAL_ID = 't1'; POIMEN_SOCKET = '/s' } },
        @{ n = 'poimen-id-only'; e = @{ POIMEN_TERMINAL_ID = 't1' } },
        @{ n = 'herdr'; e = @{ HERDR_ENV = '1' } },
        @{ n = 'both'; e = @{ HERDR_ENV = '1'; POIMEN_TERMINAL_ID = 't1'; POIMEN_SOCKET = '/s' } },
        @{ n = 'none'; e = @{} },
        @{ n = 'forced'; e = @{ HERDR_ENV = '1'; DELIVER_TERMINAL_BACKEND = 'none' } },
        @{ n = 'invalid-override'; e = @{ HERDR_ENV = '1'; DELIVER_TERMINAL_BACKEND = 'tmux' } }
      )) {
        foreach ($k in 'HERDR_ENV','POIMEN_TERMINAL_ID','POIMEN_SOCKET','DELIVER_TERMINAL_BACKEND') { Remove-Item "Env:$k" -ErrorAction SilentlyContinue }
        foreach ($k in $c.e.Keys) { Set-Item "Env:$k" $c.e[$k] }
        "$($c.n)=$(Get-TerminalBackend)"
      }`;
    const r = run(script);
    expect(r.stdout.trim().split('\n')).toEqual([
      'poimen=poimen',
      'poimen-id-only=none',
      'herdr=herdr',
      'both=poimen',
      'none=none',
      'forced=none',
      'invalid-override=herdr',
    ]);
  });

  it('none: every operation is a no-op with exactly one notice per run', () => {
    const r = run(`
      Open-LogPane -LogFile (Join-Path '${dir}' 'x.log')
      'workspace=' + (New-LoopWorkspace -Cwd '${dir}' -Label l -TabLabel t -Command c)
      'switch=' + (Switch-LogPane -Pane p1 -Tab t1)`);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('workspace=False');
    expect(r.stdout).toContain('switch=noop');
    expect(r.stderr.match(/terminal backend 'none'/g)).toHaveLength(1);
    expect(recorded()).toEqual([]);
  });

  it('poimen: workspace and log pane are notice-only', () => {
    const r = run(
      `Open-LogPane -LogFile '${path.join(dir, 'x.log')}'
       'workspace=' + (New-LoopWorkspace -Cwd '${dir}' -Label l -TabLabel t -Command c)`,
      { POIMEN_TERMINAL_ID: 't1', POIMEN_SOCKET: '/s' },
    );
    expect(r.stdout).toContain('workspace=False');
    expect(r.stderr.match(/terminal backend 'poimen'/g)).toHaveLength(1);
    expect(recorded()).toEqual([]);
  });

  it('the display state functions are gone: nothing reports tokens or agent state (ADR 0002, #417)', () => {
    const src = fs.readFileSync(path.join(scripts, 'TerminalBackend.ps1'), 'utf8');
    for (const gone of [
      'Set-LoopTokens',
      'Clear-LoopTokens',
      'Set-LoopAgentState',
      'Clear-LoopAgentState',
      'Invoke-Poimen',
    ])
      expect(src).not.toContain(gone);
    for (const f of fs.readdirSync(scripts).filter((x) => x.endsWith('.ps1'))) {
      const text = fs.readFileSync(path.join(scripts, f), 'utf8');
      expect(text, f).not.toMatch(/report-metadata|report-agent|release-agent|poimen-server/);
    }
  });

  it('only TerminalBackend.ps1 calls the terminal CLI in the deliver scripts', () => {
    const offenders = fs
      .readdirSync(scripts)
      .filter((f) => f.endsWith('.ps1') && f !== 'TerminalBackend.ps1')
      .filter((f) => /&\s*herdr\b/.test(fs.readFileSync(path.join(scripts, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
