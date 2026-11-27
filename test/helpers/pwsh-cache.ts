import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// setupFiles (#56): every pwsh a test starts inherits XDG_CACHE_HOME, so the pwsh processes of one worker slot (one test file
// at a time) share a cache directory and no two parallel test files touch the same startup profile (see pwsh-cache-global.ts).
const root = process.env.VITEST_PWSH_CACHE_ROOT;
if (root) {
  const dir = path.join(root, `slot-${process.env.VITEST_POOL_ID ?? '0'}`);
  fs.mkdirSync(dir, { recursive: true });
  process.env.XDG_CACHE_HOME = dir;
}

// #1078: writers default to the per-user events directory and prune it; no test may reach the real one
const state = path.join(root ?? os.tmpdir(), `state-${process.env.VITEST_POOL_ID ?? '0'}`);
delete process.env.AGENT_EVENTS_DIR;
process.env.XDG_STATE_HOME = state;
process.env.LOCALAPPDATA = state;
