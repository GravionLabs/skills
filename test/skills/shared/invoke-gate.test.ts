import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(root, 'skills/shared/implementation/scripts/Invoke-Gate.ps1');
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
// timeout: the tests start pwsh, which needs more than the 5 s default on a loaded machine
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

describe.skipIf(!hasPwsh || process.platform === 'win32')('Invoke-Gate.ps1', () => {
  let tmp: string;
  const mk = (name: string, cfg?: unknown) => {
    const d = fs.mkdtempSync(path.join(tmp, `${name}-`));
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: d });
    if (cfg !== undefined) {
      fs.mkdirSync(path.join(d, '.agents'));
      fs.writeFileSync(path.join(d, '.agents/config.json'), JSON.stringify(cfg));
    }
    return d;
  };
  const run = (cwd: string, ...args: string[]) =>
    spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, ...args], { cwd, encoding: 'utf8' });

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'gate-')));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('runs the configured command, prints its output and returns exit 0', () => {
    const r = run(mk('ok', { gate: 'echo gate-ran' }));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('gate-ran');
  });
  it('passes the exit code of a failing command', () => {
    const r = run(mk('bad', { gate: 'echo broken >&2; exit 7' }));
    expect(r.status).toBe(7);
    expect(r.stderr + r.stdout).toContain('broken');
  });
  it('runs in the repository root', () => {
    const d = mk('sub', { gate: 'pwd' });
    fs.mkdirSync(path.join(d, 'x'));
    expect(run(path.join(d, 'x')).stdout.trim()).toBe(d);
  });
  it.each([
    ['no config', undefined],
    ['no gate key', {}],
    ['gate false', { gate: false }],
  ])('skips with %s', (_n, cfg) => {
    const r = run(mk('skip', cfg));
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('skipped: no gate configured');
  });
  it('-WhatIf prints the command without running it', () => {
    const d = mk('what', { gate: 'touch ran.txt' });
    const r = run(d, '-WhatIf');
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('touch ran.txt');
    expect(fs.existsSync(path.join(d, 'ran.txt'))).toBe(false);
  });
  it('fails on invalid JSON', () => {
    const d = mk('json', {});
    fs.writeFileSync(path.join(d, '.agents/config.json'), '{');
    expect(run(d).status).toBe(1);
  });
});

describe('skill texts name the gate key', () => {
  it('implementation SKILL.md', () => {
    const t = read('skills/shared/implementation/SKILL.md');
    expect(t).toContain('`gate`');
    expect(t).toContain('scripts/Invoke-Gate.ps1');
    expect(t).toContain('Without `gate`');
  });
  it('deliver SKILL.md', () => {
    const t = read('skills/delivery/deliver/SKILL.md');
    expect(t).toContain('`gate`');
    expect(t).toContain('Invoke-Gate.ps1');
    expect(t).toContain('full suite still runs once before the pull request');
  });
});
