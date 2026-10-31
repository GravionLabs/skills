import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const hasPwsh = spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' }).status === 0;

// #56: parallel test files that start pwsh against one shared ~/.cache/powershell crash it at startup now and then
// (torn startup profile: SIGSEGV, SIGABRT, FileLoadException). vitest.config.ts gives every worker slot its own cache.
describe('pwsh cache per vitest worker slot', () => {
  const cache = process.env.XDG_CACHE_HOME ?? '';

  it('points XDG_CACHE_HOME at this slot, below the cache root of this run in the temp dir', () => {
    const root = process.env.VITEST_PWSH_CACHE_ROOT ?? '';
    expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(root)).toMatch(/^vitest-pwsh-cache-/);
    expect(cache).toBe(path.join(root, `slot-${process.env.VITEST_POOL_ID}`));
    expect(fs.statSync(cache).isDirectory()).toBe(true);
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
