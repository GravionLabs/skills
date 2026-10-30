import { configDefaults, defineConfig } from 'vitest/config';

// One project: test/repo and test/skills. Many cases spawn pwsh, bash or git, so the timeouts are generous.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/repo/**/*.test.ts', 'test/skills/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/.worktrees/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
    // github-actions turns failures into annotations, readable without the log download.
    reporters: [
      'default',
      ['junit', { outputFile: 'test-results/junit.xml' }],
      ...(process.env['GITHUB_ACTIONS'] ? ['github-actions'] : []),
    ],
    coverage: {
      provider: 'v8',
      reporter: ['cobertura', 'text'],
      reportsDirectory: 'coverage',
    },
  },
});
