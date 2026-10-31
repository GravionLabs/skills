import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// globalSetup (#56): one cache root per vitest run; test/helpers/pwsh-cache.ts gives each worker slot its own directory below it.
// pwsh reads and rewrites its startup JIT profile ($XDG_CACHE_HOME/powershell/StartupProfileData-NonInteractive) on every
// start; parallel test files starting pwsh against the one shared ~/.cache/powershell read it torn and crash at startup
// (SIGSEGV, SIGABRT, "FileLoadException: The given assembly name was invalid").
export default function setup(): () => void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-pwsh-cache-'));
  process.env.VITEST_PWSH_CACHE_ROOT = root;
  return () => fs.rmSync(root, { recursive: true, force: true });
}
