import { availableParallelism } from 'node:os';
import { configDefaults, defineConfig } from 'vitest/config';

// #679: every deliver-loop case starts nested pwsh, sh and node processes. On a many-core machine the full
// run saturates it with process starts and a case exceeds the 25 s per-call limit of PwshWorker. At most 4
// workers: a 4-core CI runner keeps its 4 (no slower), a 12-core Mac no longer runs 11.
const maxWorkers = Math.min(availableParallelism(), 4);

// One project: test/repo and test/skills. Many cases spawn pwsh, bash or git, so the timeouts are generous.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/repo/**/*.test.ts', 'test/skills/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/.worktrees/**'],
    maxWorkers,
    testTimeout: 30000,
    hookTimeout: 30000,
    // #56: a pwsh cache directory per worker slot; parallel files sharing ~/.cache/powershell crash pwsh at startup
    globalSetup: ['test/helpers/pwsh-cache-global.ts'],
    // #672: no deliver-loop retry wait sleeps in a test (loop-waits.ts)
    setupFiles: ['test/helpers/pwsh-cache.ts', 'test/helpers/loop-waits.ts'],
    // github-actions turns failures into annotations, readable without the log download.
    // CI shards set VITEST_JUNIT_OUTPUT per shard so the junit files do not collide.
    reporters: [
      'default',
      ['junit', { outputFile: process.env['VITEST_JUNIT_OUTPUT'] ?? 'test-results/junit.xml' }],
      ...(process.env['GITHUB_ACTIONS'] ? ['github-actions'] : []),
    ],
    coverage: {
      provider: 'v8',
      reporter: ['cobertura', 'text'],
      reportsDirectory: 'coverage',
    },
  },
});
