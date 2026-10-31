import * as fs from 'fs';
import * as path from 'path';

// setupFiles (#56): every pwsh a test starts inherits XDG_CACHE_HOME, so the pwsh processes of one worker slot (one test file
// at a time) share a cache directory and no two parallel test files touch the same startup profile (see pwsh-cache-global.ts).
const root = process.env.VITEST_PWSH_CACHE_ROOT;
if (root) {
  const dir = path.join(root, `slot-${process.env.VITEST_POOL_ID ?? '0'}`);
  fs.mkdirSync(dir, { recursive: true });
  process.env.XDG_CACHE_HOME = dir;
}
