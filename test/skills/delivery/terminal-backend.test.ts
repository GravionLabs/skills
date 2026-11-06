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
      Set-LoopTokens -Pane p1 -Token ([ordered]@{ deliver = '#1' })
      Clear-LoopTokens -Pane p1 -Name deliver
      Set-LoopAgentState -Pane p1 -State working
      Clear-LoopAgentState -Pane p1
      Open-LogPane -LogFile (Join-Path '${dir}' 'x.log')
      'workspace=' + (New-LoopWorkspace -Cwd '${dir}' -Label l -TabLabel t -Command c)
      'switch=' + (Switch-LogPane -Pane p1 -Tab t1)`);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('workspace=False');
    expect(r.stdout).toContain('switch=noop');
    expect(r.stderr.match(/terminal backend 'none'/g)).toHaveLength(1);
    expect(recorded()).toEqual([]);
  });

  it('herdr: tokens and agent state keep the pane id right after the subcommand', () => {
    const r = run(
      `Set-LoopTokens -Pane w1:p2 -Token ([ordered]@{ deliver = '#7'; deliver_step = '1/2 impl' }) -TtlMs 5
       Clear-LoopTokens -Pane w1:p2 -Name deliver, deliver_pr
       Set-LoopAgentState -Pane w1:p2 -State blocked
       Clear-LoopAgentState -Pane w1:p2`,
      { HERDR_ENV: '1' },
    );
    expect(r.stderr).toBe('');
    expect(recorded()).toEqual([
      'herdr pane report-metadata w1:p2 --source deliver --token deliver=#7 --token deliver_step=1/2 impl --ttl-ms 5',
      'herdr pane report-metadata w1:p2 --source deliver --clear-token deliver --clear-token deliver_pr',
      'herdr pane report-agent w1:p2 --state blocked --source deliver-loop --agent deliver',
      'herdr pane release-agent w1:p2 --source deliver-loop --agent deliver',
    ]);
  });

  it('poimen: tokens and agent state use poimen-server report; workspace and log pane are notice-only', () => {
    const r = run(
      `Set-LoopTokens -Pane t1 -Token ([ordered]@{ deliver = '#7' }) -TtlMs 5
       Clear-LoopTokens -Pane t1 -Name deliver
       Set-LoopAgentState -Pane t1 -State idle
       Clear-LoopAgentState -Pane t1
       Open-LogPane -LogFile '${path.join(dir, 'x.log')}'
       'workspace=' + (New-LoopWorkspace -Cwd '${dir}' -Label l -TabLabel t -Command c)`,
      { POIMEN_TERMINAL_ID: 't1', POIMEN_SOCKET: '/s' },
    );
    expect(r.stdout).toContain('workspace=False');
    expect(r.stderr.match(/terminal backend 'poimen'/g)).toHaveLength(1);
    expect(recorded()).toEqual([
      'poimen-server report tokens --source deliver --token deliver=#7 --ttl-ms 5',
      'poimen-server report clear --source deliver --clear-token deliver',
      'poimen-server report agent --state idle --source deliver-loop --agent deliver',
      'poimen-server report agent --release --source deliver-loop --agent deliver',
    ]);
  });

  it('a failing backend call does not fail the caller', () => {
    stub('herdr', 'exit 1');
    stub('poimen-server', 'exit 1');
    const r = run(
      `Set-LoopTokens -Pane p -Token ([ordered]@{ a = 'b' }); Set-LoopAgentState -Pane p -State idle; 'ok'`,
      { HERDR_ENV: '1' },
    );
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('ok');
    const p = run(`Set-LoopAgentState -Pane p -State idle; 'ok'`, {
      DELIVER_TERMINAL_BACKEND: 'poimen',
    });
    expect(p.stdout.trim()).toBe('ok');
  });

  it('only TerminalBackend.ps1 calls the terminal CLI in the deliver scripts', () => {
    const offenders = fs
      .readdirSync(scripts)
      .filter((f) => f.endsWith('.ps1') && f !== 'TerminalBackend.ps1')
      .filter((f) =>
        /&\s*(herdr|poimen-server)\b/.test(fs.readFileSync(path.join(scripts, f), 'utf8')),
      );
    expect(offenders).toEqual([]);
  });
});
