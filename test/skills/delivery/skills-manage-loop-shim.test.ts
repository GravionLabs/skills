import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PwshWorker } from '../../helpers/pwsh-worker';

const script = path.resolve(
  __dirname,
  '../../../skills/delivery/skills-manage/scripts/Install-LoopShim.ps1',
);
const posix = process.platform !== 'win32';

let tmp: string;
let worker: PwshWorker;
const mk = (...p: string[]) => {
  const d = path.join(tmp, ...p);
  fs.mkdirSync(d, { recursive: true });
  return d;
};
type Result = {
  dryRun: boolean;
  files: { path: string; action: string }[];
  profiles: { path: string; action: string }[];
  onPath: boolean;
  pathHint: string | null;
};
const install = async (args: string[], env: NodeJS.ProcessEnv = {}) => {
  const r = await worker.run([...args], { cwd: tmp, env: { ...process.env, ...env } });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as Result;
};
const OLD = 'a\n\n# >>> deliver-loop >>>\ndeliver-loop() { :; }\n# <<< deliver-loop <<<\nb\n';

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loop-shim-')));
  worker = new PwshWorker(script);
});
afterAll(async () => {
  worker.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe.skipIf(!posix)('Install-LoopShim on macOS and Linux', () => {
  it('writes an executable launcher that starts deliver-loop.mts with the arguments', async () => {
    const bin = mk('u1/bin');
    const result = await install(['-BinDir', bin, '-Profiles', path.join(tmp, 'u1/none')]);
    const file = path.join(bin, 'deliver-loop');
    expect(result.files).toEqual([{ path: file, action: 'add' }]);
    expect(fs.statSync(file).mode & 0o111).not.toBe(0);

    const repo = mk('u1/repo');
    spawnSync('git', ['init', '-q'], { cwd: repo });
    const skill = mk('u1/repo/.agents/skills/deliver/scripts');
    fs.writeFileSync(
      path.join(skill, 'deliver-loop.mts'),
      'console.log(`cwd=${process.cwd()} args=${process.argv.slice(2).join(",")}`);',
    );
    const sub = mk('u1/repo/sub');
    const run = spawnSync(file, ['--milestone', 'M1'], {
      cwd: sub,
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: mk('u1/home') },
    });
    expect(run.stdout.trim()).toBe(`cwd=${fs.realpathSync(repo)} args=--milestone,M1`);

    const none = spawnSync(file, [], {
      cwd: mk('u1/empty'),
      encoding: 'utf8',
      env: { PATH: process.env.PATH, HOME: mk('u1/home2') },
    });
    expect(none.status).toBe(1);
    expect(none.stderr).toContain('no installed deliver skill found');
  });

  it('removes the old function block from every profile and a second run changes nothing', async () => {
    const bin = mk('u2/bin');
    const zsh = path.join(mk('u2'), '.zshrc');
    const bash = path.join(tmp, 'u2/.bashrc');
    const pwsh = path.join(tmp, 'u2/profile.ps1');
    for (const f of [zsh, bash, pwsh]) fs.writeFileSync(f, OLD);
    const args = ['-BinDir', bin, '-Profiles', [zsh, bash, pwsh].join(',')];

    const first = await install(args);
    expect(first.profiles.map((p) => p.action)).toEqual(['removed', 'removed', 'removed']);
    for (const f of [zsh, bash, pwsh]) expect(fs.readFileSync(f, 'utf8')).toBe('a\nb\n');

    const second = await install(args);
    expect(second.files.map((f) => f.action)).toEqual(['unchanged']);
    expect(second.profiles.map((p) => p.action)).toEqual(['none', 'none', 'none']);
  });

  it('dry run writes nothing and an outdated launcher is updated', async () => {
    const bin = mk('u3/bin');
    const zsh = path.join(tmp, 'u3/.zshrc');
    fs.writeFileSync(zsh, OLD);
    const dry = await install(['-BinDir', bin, '-Profiles', zsh, '-DryRun']);
    expect(dry.dryRun).toBe(true);
    expect(dry.profiles[0].action).toBe('removed');
    expect(fs.existsSync(path.join(bin, 'deliver-loop'))).toBe(false);
    expect(fs.readFileSync(zsh, 'utf8')).toBe(OLD);

    fs.writeFileSync(path.join(bin, 'deliver-loop'), '#!/bin/sh\necho old\n');
    const real = await install(['-BinDir', bin, '-Profiles', zsh]);
    expect(real.files[0].action).toBe('update');
  });

  it('reports a bin directory that is not in PATH and never changes PATH or the profile for it', async () => {
    const bin = mk('u4/bin');
    const zsh = path.join(tmp, 'u4/.zshrc');
    fs.writeFileSync(zsh, 'export X=1\n');
    const off = await install(['-BinDir', bin, '-Profiles', zsh], { PATH: '/usr/bin' });
    expect(off.onPath).toBe(false);
    expect(off.pathHint).toContain('export PATH=');
    expect(fs.readFileSync(zsh, 'utf8')).toBe('export X=1\n');

    const on = await install(['-BinDir', bin, '-Profiles', zsh], {
      PATH: `/usr/bin${path.delimiter}${bin}/`,
    });
    expect(on.onPath).toBe(true);
    expect(on.pathHint).toBeNull();
  });
});

describe('Install-LoopShim for Windows', () => {
  it('writes deliver-loop.cmd (CRLF, calls the .ps1) and deliver-loop.ps1 (starts node)', async () => {
    const bin = mk('w1/bin');
    const result = await install([
      '-BinDir',
      bin,
      '-Platform',
      'windows',
      '-Profiles',
      path.join(tmp, 'w1/none'),
    ]);
    expect(result.files.map((f) => path.basename(f.path))).toEqual([
      'deliver-loop.cmd',
      'deliver-loop.ps1',
    ]);
    const cmd = fs.readFileSync(path.join(bin, 'deliver-loop.cmd'), 'utf8');
    expect(cmd).toContain('deliver-loop.ps1');
    expect(cmd.split('\n').every((l) => l === '' || l.endsWith('\r'))).toBe(true);
    const ps1 = fs.readFileSync(path.join(bin, 'deliver-loop.ps1'), 'utf8');
    expect(ps1).toContain("node (Join-Path $dir 'scripts/deliver-loop.mts') @args");
    expect(result.pathHint).toContain('SetEnvironmentVariable');
    expect(
      (
        await install([
          '-BinDir',
          bin,
          '-Platform',
          'windows',
          '-Profiles',
          path.join(tmp, 'w1/none'),
        ])
      ).files.map((f) => f.action),
    ).toEqual(['unchanged', 'unchanged']);
  });
});
