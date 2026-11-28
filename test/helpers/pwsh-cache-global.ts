import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// globalSetup (#56): one cache root per vitest run; test/helpers/pwsh-cache.ts gives each worker slot its own directory below it.
// pwsh reads and rewrites its startup JIT profile ($XDG_CACHE_HOME/powershell/StartupProfileData-NonInteractive) on every
// start; parallel test files starting pwsh against the one shared ~/.cache/powershell read it torn and crash at startup
// (SIGSEGV, SIGABRT, "FileLoadException: The given assembly name was invalid").
// os.tmpdir() and .NET GetTempPath() read TMPDIR on Linux and macOS, TEMP and TMP on Windows.
const TEMP_VARIABLES = ['TMPDIR', 'TEMP', 'TMP'];

export default function setup(): () => void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-pwsh-cache-'));
  process.env.VITEST_PWSH_CACHE_ROOT = root;
  // The temp dir of the whole run: workers and the processes they start create their files below the root,
  // so the teardown also removes what a test leaves behind (a tmpfs /tmp ran into its quota this way).
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(tmp);
  const before = TEMP_VARIABLES.map((name) => [name, process.env[name]] as const);
  for (const name of TEMP_VARIABLES) process.env[name] = tmp;
  return () => {
    for (const [name, value] of before) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  };
}
