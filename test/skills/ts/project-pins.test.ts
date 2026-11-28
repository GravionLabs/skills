import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const skills = path.resolve(__dirname, '../../../skills');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const json = (file: string) => JSON.parse(fs.readFileSync(file, 'utf-8'));
const text = (file: string) => fs.readFileSync(file, 'utf-8').trim();
const PNPM_12 = /^pnpm@12\.\d+\.\d+$/;

describe.skipIf(!hasPwsh)('Node and pnpm pins of scaffolded projects (#1187)', () => {
  let out: string;
  beforeEach(() => {
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'pins-'));
  });
  afterEach(() => {
    fs.rmSync(out, { recursive: true, force: true });
  });

  const scaffold = (script: string, args: string[], env = process.env) =>
    execFileSync('pwsh', ['-NoProfile', '-File', path.join(skills, script), ...args], {
      cwd: out,
      env,
      stdio: 'pipe',
    });

  // package managers and `ng` are stubs: no network, and the test does not depend on an installed Angular CLI
  const stubs = () => {
    const bin = path.join(out, 'bin');
    fs.mkdirSync(bin);
    const stub = (name: string, body: string) =>
      fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
    stub('npm', 'exit 0');
    stub('pnpm', 'exit 0');
    stub('ng', `mkdir "$2" && echo '{"name":"demo","scripts":{}}' > "$2/package.json"`);
    return { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` };
  };

  describe.skipIf(process.platform === 'win32')('TypeScript and Angular', () => {
    it.each([
      ['ts', 'npm'],
      ['ts', 'pnpm'],
      ['ng', 'npm'],
      ['ng', 'pnpm'],
    ])('%s project with %s', (kind, manager) => {
      const script =
        kind === 'ts'
          ? 'ts/ts-create-project/scripts/New-NodeProject.ps1'
          : 'ng/ng-create-project/scripts/New-AngularProject.ps1';
      const skip = kind === 'ng' ? ['-SkipVitest', '-SkipLint'] : [];
      const args = ['-ProjectName', 'demo', '-PackageManager', manager, '-OutputDirectory', out];
      scaffold(script, [...args, ...skip], stubs());
      const pkg = json(path.join(out, 'demo/package.json'));
      expect(text(path.join(out, 'demo/.nvmrc'))).toBe('26');
      expect(pkg.engines).toEqual({ node: '>=26' });
      if (manager === 'pnpm') expect(pkg.packageManager).toMatch(PNPM_12);
      else expect(pkg).not.toHaveProperty('packageManager');
    });
  });

  it('both create skills pin the same pnpm version', () => {
    const pin = (skill: string) =>
      json(path.join(skills, skill, 'templates/package.json')).packageManager;
    expect(pin('ng/ng-create-project')).toBe(pin('ts/ts-create-project'));
  });
});
