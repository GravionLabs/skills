import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(root, 'skills/shared/implementation/templates/check-changed.mts');
const posix = process.platform !== 'win32';

// Fake tools in node_modules/.bin print their arguments and fail when a marker file exists.
const fake = (name: string) =>
  `#!/usr/bin/env node
const fs = require('fs');
console.log('${name} ' + process.argv.slice(2).join(' '));
if (fs.existsSync('fail-${name}')) { console.error('${name} says no'); process.exit(1); }
`;

describe.skipIf(!posix)('check-changed.mts', () => {
  let tmp: string;
  const sh = (cmd: string, ...args: string[]) =>
    spawnSync(cmd, args, { cwd: tmp, encoding: 'utf8' });
  const runRaw = (...args: string[]) => {
    const r = sh(process.execPath, SCRIPT, ...args);
    return { status: r.status, out: r.stdout, err: r.stderr };
  };
  const run = (...args: string[]) => runRaw('--no-cache', ...args);

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'check-changed-'));
    const bin = path.join(tmp, 'node_modules/.bin');
    fs.mkdirSync(bin, { recursive: true });
    for (const t of ['oxfmt', 'oxlint', 'vitest']) {
      fs.writeFileSync(path.join(bin, t), fake(t), { mode: 0o755 });
    }
    fs.mkdirSync(path.join(tmp, '.agents'));
    fs.writeFileSync(
      path.join(tmp, '.agents/config.json'),
      JSON.stringify({ checks: [{ name: 'extra', command: 'echo extra-check-output' }] }),
    );
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'export const a = 1;\n');
    fs.writeFileSync(path.join(tmp, '.gitignore'), 'node_modules\nfail-*\n');
    sh('git', 'init', '-q', '-b', 'main');
    sh('git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '.');
    sh('git', '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
    sh('git', 'checkout', '-q', '-b', 'work');
    fs.writeFileSync(path.join(tmp, 'b.ts'), 'export const b = 2;\n'); // untracked
    fs.appendFileSync(path.join(tmp, 'a.ts'), 'export const c = 3;\n'); // modified
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
  afterEach(() => {
    for (const t of ['oxfmt', 'oxlint', 'vitest'])
      fs.rmSync(path.join(tmp, `fail-${t}`), { force: true });
  });

  it('green run prints one line and exits 0', () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.out.trim().split('\n')).toEqual(['check:changed: ok (2 changed files)']);
  });

  it('a failing step prints only its own output and exits non-zero', () => {
    fs.writeFileSync(path.join(tmp, 'fail-oxlint'), '');
    const r = run('--base=main');
    expect(r.status).toBe(1);
    expect(r.out).toContain('=== check:changed lint: FAILED');
    expect(r.out).toContain('oxlint says no');
    expect(r.out).not.toContain('oxfmt');
    expect(r.out).not.toContain('vitest');
    expect(r.out).not.toContain('extra-check-output');
  });

  it('a failing config check prints its output', () => {
    const cfg = path.join(tmp, '.agents/config.json');
    const orig = fs.readFileSync(cfg, 'utf8');
    fs.writeFileSync(
      cfg,
      JSON.stringify({ checks: [{ name: 'bad', command: 'echo nope; exit 3' }] }),
    );
    const r = run();
    fs.writeFileSync(cfg, orig);
    expect(r.status).toBe(1);
    expect(r.out).toContain('check bad: FAILED (exit 3)');
    expect(r.out).toContain('nope');
  });

  it('selects tests with vitest related from the changed files and passes the worker limit', () => {
    fs.writeFileSync(path.join(tmp, 'fail-vitest'), '');
    const r = spawnSync(process.execPath, [SCRIPT, '--no-cache'], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, GATE_MAX_WORKERS: '3' },
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('vitest related --run --maxWorkers=3 a.ts b.ts');
  });

  it('exits 2 for an unknown base', () => {
    const r = run('--base=nope');
    expect(r.status).toBe(2);
    expect(r.err).toContain('merge-base');
  });

  describe('pass cache', () => {
    const cacheDir = () => path.join(tmp, '.git/check-changed');
    const entries = () => (fs.existsSync(cacheDir()) ? fs.readdirSync(cacheDir()).length : 0);
    beforeEach(() => fs.rmSync(cacheDir(), { recursive: true, force: true }));
    afterEach(() => {
      fs.writeFileSync(path.join(tmp, 'b.ts'), 'export const b = 2;\n');
      fs.rmSync(path.join(tmp, '.agents/config.json.bak'), { force: true });
    });

    it('a second run on unchanged content is a cache hit, stored under the git dir', () => {
      expect(runRaw().out).toContain('check:changed: ok');
      expect(entries()).toBe(1);
      const second = runRaw();
      expect(second.status).toBe(0);
      expect(second.out.trim()).toBe('cached pass');
      expect(fs.existsSync(path.join(tmp, 'check-changed'))).toBe(false);
    });

    it('--no-cache ignores the cache and stores nothing', () => {
      expect(runRaw('--no-cache').out).toContain('check:changed: ok');
      expect(entries()).toBe(0);
      runRaw();
      expect(runRaw('--no-cache').out).toContain('check:changed: ok');
    });

    it('a changed file is a cache miss', () => {
      runRaw();
      fs.writeFileSync(path.join(tmp, 'b.ts'), 'export const b = 22;\n');
      expect(runRaw().out).toContain('check:changed: ok');
      expect(entries()).toBe(2);
    });

    it('another --base is a cache miss', () => {
      const id = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
      sh('git', 'branch', '-f', 'other', 'main');
      sh('git', 'checkout', '-q', 'other');
      sh('git', ...id, 'commit', '-q', '--allow-empty', '-m', 'other');
      sh('git', 'checkout', '-q', 'work');
      expect(runRaw('--base=main').out).toContain('check:changed: ok');
      expect(runRaw('--base=other').out).toContain('check:changed: ok');
      expect(entries()).toBe(2);
    });

    it('a changed step list is a cache miss', () => {
      runRaw();
      const cfg = path.join(tmp, '.agents/config.json');
      const orig = fs.readFileSync(cfg, 'utf8');
      fs.writeFileSync(cfg, JSON.stringify({ checks: [{ name: 'more', command: 'echo more' }] }));
      const r = runRaw();
      fs.writeFileSync(cfg, orig);
      expect(r.out).toContain('check:changed: ok');
      expect(entries()).toBe(2);
    });

    it('a failed run is never cached', () => {
      fs.writeFileSync(path.join(tmp, 'fail-oxlint'), '');
      expect(runRaw().status).toBe(1);
      expect(entries()).toBe(0);
      expect(runRaw().status).toBe(1);
    });
  });
});
