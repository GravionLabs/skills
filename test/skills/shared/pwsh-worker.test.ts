import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
if (!hasPwsh && process.env.CI) throw new Error('pwsh is required in CI');

// Contract of the shared pwsh worker (test/helpers/pwsh-worker.ts, invoke-case.ps1) that several script tests rely on.
describe.skipIf(!hasPwsh)('PwshWorker', () => {
  let dir: string;
  let worker: PwshWorker;
  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'worker-')));
    const script = path.join(dir, 'probe.ps1');
    fs.writeFileSync(
      script,
      [
        'param([string]$Mode, [string]$Value, [switch]$Flag)',
        'switch ($Mode) {',
        '  \'echo\' { Write-Output "cwd=$((Get-Location).Path) env=$env:PROBE_VAR flag=$Flag value=$Value net=$([Environment]::CurrentDirectory)" }',
        "  'host' { 'table' | Out-Host; Write-Host 'info'; Write-Warning 'warn'; Write-Error 'err' -ErrorAction Continue }",
        "  'exit3' { exit 3 }",
        "  'throw' { throw 'boom' }",
        "  'nativefail' { git -C /nonexistent status 2>$null | Out-Null }",
        "  'leak' { $env:LEAKED_VAR = 'x' }",
        '  \'noleak\' { Write-Output "e=[$env:LEAKED_VAR]" }',
        '}',
      ].join('\n'),
    );
    worker = new PwshWorker(script);
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('passes args, cwd (also as process directory) and the complete env, and restores the env afterwards', async () => {
    const r = await worker.run(['echo', '-Flag', '-Value', 'v'], {
      cwd: dir,
      env: { ...process.env, PROBE_VAR: 'p' },
    });
    expect(r).toEqual({
      status: 0,
      stdout: `cwd=${dir} env=p flag=True value=v net=${dir}\n`,
      stderr: '',
    });
    const again = await worker.run(['echo'], { cwd: dir, env: { ...process.env } });
    expect(again.stdout).toContain('env= ');
  });

  it('captures host output on stdout and error/warning records on stderr', async () => {
    const r = await worker.run(['host'], { cwd: dir });
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('table\ninfo\n');
    expect(r.stderr).toBe('warn\nerr\n');
  });

  it('reports exit codes like pwsh -File: exit N, thrown error, and no leak of an earlier failed native command', async () => {
    expect((await worker.run(['exit3'], { cwd: dir })).status).toBe(3);
    const t = await worker.run(['throw'], { cwd: dir });
    expect(t.status).toBe(1);
    expect(t.stderr).toContain('boom');
    expect((await worker.run(['nativefail'], { cwd: dir })).status).toBe(0);
  });

  it('survives a call with an unknown parameter and keeps answering', async () => {
    const bad = await worker.run(['echo', '-Nope'], { cwd: dir });
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain('unknown parameter -Nope');
    expect((await worker.run(['echo'], { cwd: dir })).status).toBe(0);
  });

  it('does not carry env changes of one call into the next', async () => {
    await worker.run(['leak'], { cwd: dir });
    const r = await worker.run(['noleak'], { cwd: dir });
    expect(r.stdout).toBe('e=[]\n');
  });
});
