import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const delivery = path.resolve(__dirname, '../../../skills/delivery');
const shimSh = path.join(delivery, 'skills-install/templates/deliver-loop.sh');
const installScript = path.join(delivery, 'skills-install/scripts/Install-LoopShim.ps1');
const startScript = path.join(delivery, 'deliver/scripts/Start-LoopWorkspace.ps1');
const posix = process.platform !== 'win32';

let tmp: string;
const mk = (...p: string[]) => {
  const d = path.join(tmp, ...p);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
// a fake installed deliver skill whose loop script reports where it ran from and its arguments
const fakeSkill = (base: string, marker: string) => {
  const dir = mk(base, 'deliver/scripts');
  fs.writeFileSync(
    path.join(dir, 'Invoke-DeliverLoop.ps1'),
    `Write-Output "${marker}|$($args -join ',')"\nexit 3\n`,
  );
  fs.copyFileSync(startScript, path.join(dir, 'Start-LoopWorkspace.ps1'));
};
const runShim = (cwd: string, home: string, args: string[], env: NodeJS.ProcessEnv = {}) =>
  spawnSync('bash', ['-c', `. "${shimSh}"; deliver-loop "$@"`, 'bash', ...args], {
    cwd,
    encoding: 'utf8',
    env: { PATH: process.env.PATH, HOME: home, ...env },
  });

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loop-shim-')));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe.skipIf(!posix)('deliver-loop shell function', () => {
  it('prefers the project install, passes all arguments and the exit code through', () => {
    const home = mk('h1');
    const proj = mk('p1');
    fakeSkill('h1/.claude/skills', 'global-claude');
    fakeSkill('p1/.claude/skills', 'project');
    const r = runShim(proj, home, [
      '-Milestone',
      '1.3.0',
      '-Target',
      '12,14',
      '-Max',
      '2',
      '-Harness',
      'copilot',
    ]);
    expect(r.stdout.trim()).toBe('project|-Milestone,1.3.0,-Target,12,14,-Max,2,-Harness,copilot');
    expect(r.status).toBe(3);
  });

  it('falls back from ~/.claude/skills to ~/.agents/skills', () => {
    const proj = mk('p2');
    const homeAgents = mk('h2');
    fakeSkill('h2/.agents/skills', 'global-agents');
    expect(runShim(proj, homeAgents, ['-Max', '1']).stdout.trim()).toBe('global-agents|-Max,1');
    const homeBoth = mk('h3');
    fakeSkill('h3/.agents/skills', 'global-agents');
    fakeSkill('h3/.claude/skills', 'global-claude');
    expect(runShim(proj, homeBoth, []).stdout.trim()).toBe('global-claude|');
  });

  it('reports a missing install and exits 1', () => {
    const r = runShim(mk('p4'), mk('h4'), []);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no installed deliver skill');
  });

  it('starts the loop in its own herdr workspace instead of the calling pane', () => {
    const home = mk('h5');
    const proj = mk('p5/my repo');
    fakeSkill('h5/.claude/skills', 'global-claude');
    const bin = mk('bin5');
    const log = path.join(tmp, 'herdr.log');
    fs.writeFileSync(
      path.join(bin, 'herdr'),
      `#!/bin/sh\necho "$@" >> "${log}"\n` +
        `if [ "$1 $2" = "workspace create" ]; then echo '{"result":{"workspace":{"workspace_id":"w9"},"tab":{"tab_id":"w9:t1"},"root_pane":{"pane_id":"w9:p1"}}}'; fi\n`,
      { mode: 0o755 },
    );
    const r = runShim(proj, home, ['-Milestone', "it's"], {
      HERDR_ENV: '1',
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('global-claude|'); // the loop did not run in the calling terminal
    const calls = fs.readFileSync(log, 'utf8').trim().split('\n');
    expect(calls[0]).toContain('workspace create');
    expect(calls[0]).toContain('--label my repo · deliver');
    expect(calls[1]).toBe('tab rename w9:t1 deliver-loop');
    expect(calls[2]).toContain('pane run w9:p1 pwsh -NoProfile -File');
    expect(calls[2]).toContain("Invoke-DeliverLoop.ps1' '-Milestone' 'it'\\''s'");
  });

  it('runs in the current terminal when herdr fails', () => {
    const home = mk('h6');
    fakeSkill('h6/.claude/skills', 'global-claude');
    const bin = mk('bin6');
    fs.writeFileSync(path.join(bin, 'herdr'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const r = runShim(mk('p6'), home, ['-Max', '1'], {
      HERDR_ENV: '1',
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    });
    expect(r.stdout.trim()).toBe('global-claude|-Max,1');
  });
});

describe('Install-LoopShim.ps1', () => {
  let worker: PwshWorker;
  beforeAll(() => {
    worker = new PwshWorker(installScript);
  });
  afterAll(() => worker.close());

  const run = async (profile: string, extra: string[] = [], shell = 'zsh') =>
    JSON.parse(
      (await worker.run(['-Shell', shell, '-ProfilePath', profile, ...extra], { cwd: tmp })).stdout,
    );

  it('dry run shows the block and writes nothing', async () => {
    const profile = path.join(tmp, 'dry/.zshrc');
    const r = await run(profile, ['-DryRun']);
    expect(r.action).toBe('add');
    expect(r.block).toContain('deliver-loop() {');
    expect(fs.existsSync(profile)).toBe(false);
  });

  it('adds the block once, keeps existing content, and is idempotent', async () => {
    const profile = path.join(tmp, 'zshrc');
    fs.writeFileSync(profile, 'export A=1');
    expect((await run(profile)).action).toBe('add');
    const first = fs.readFileSync(profile, 'utf8');
    expect(first.startsWith('export A=1\n')).toBe(true);
    expect((await run(profile)).action).toBe('unchanged');
    expect((await run(profile, ['-DryRun'])).action).toBe('unchanged');
    expect(fs.readFileSync(profile, 'utf8')).toBe(first);
    expect(first.match(/>>> deliver-loop >>>/g)).toHaveLength(1);
  });

  it('replaces an outdated block in place', async () => {
    const profile = path.join(tmp, 'bashrc');
    fs.writeFileSync(
      profile,
      'before\n# >>> deliver-loop >>>\nold\n# <<< deliver-loop <<<\nafter\n',
    );
    expect((await run(profile, [], 'bash')).action).toBe('update');
    const s = fs.readFileSync(profile, 'utf8');
    expect(s).toMatch(/^before\n# >>> deliver-loop >>>\ndeliver-loop\(\)/);
    expect(s).toMatch(/# <<< deliver-loop <<<\nafter\n$/);
    expect(s).not.toContain('\nold\n');
  });

  it('writes the PowerShell function for -Shell pwsh', async () => {
    const profile = path.join(tmp, 'ps/profile.ps1');
    expect((await run(profile, [], 'pwsh')).action).toBe('add');
    expect(fs.readFileSync(profile, 'utf8')).toContain('function deliver-loop {');
  });
});
