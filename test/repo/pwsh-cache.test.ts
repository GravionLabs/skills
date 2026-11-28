import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const hasPwsh = spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' }).status === 0;

// #56: parallel test files that start pwsh against one shared ~/.cache/powershell crash it at startup now and then
// (torn startup profile: SIGSEGV, SIGABRT, FileLoadException). vitest.config.ts gives every worker slot its own cache.
describe('pwsh cache per vitest worker slot', () => {
  const cache = process.env.XDG_CACHE_HOME ?? '';

  it('points XDG_CACHE_HOME at this slot, below the root of this run', () => {
    const root = process.env.VITEST_PWSH_CACHE_ROOT ?? '';
    expect(path.basename(root)).toMatch(/^vitest-pwsh-cache-/);
    expect(cache).toBe(path.join(root, `slot-${process.env.VITEST_POOL_ID}`));
    expect(fs.statSync(cache).isDirectory()).toBe(true);
  });

  it('keeps the temp dir below the root of this run, so the teardown removes what tests leave', () => {
    const root = process.env.VITEST_PWSH_CACHE_ROOT ?? '';
    expect(os.tmpdir()).toBe(path.join(root, 'tmp'));
    const child = spawnSync(process.execPath, ['-p', "require('os').tmpdir()"], {
      encoding: 'utf8',
    });
    expect(child.stdout.trim()).toBe(os.tmpdir());
  });

  it.skipIf(!hasPwsh || process.platform === 'win32')(
    'a pwsh started by a test writes its startup profile there, not to the shared user cache',
    () => {
      const r = spawnSync(
        'pwsh',
        ['-NoProfile', '-NonInteractive', '-Command', 'Get-Date | Out-Null'],
        {
          encoding: 'utf8',
        },
      );
      expect(r.status, r.stderr).toBe(0);
      expect(fs.readdirSync(path.join(cache, 'powershell'))).toContain(
        'StartupProfileData-NonInteractive',
      );
    },
  );
});
