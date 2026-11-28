# Tests

- Skill content and scripts: `test/skills/<group>/<topic>.test.ts`, `<group>` is the group of the skill under test (`test/helpers/marketplace.ts` reads the groups).
- Repository files outside `skills/` (workflows, `.github/`, `scripts/`): `test/repo/`. Helpers shared by several test directories: `test/helpers/` (no `.test.ts` suffix).
- One Vitest project (`vitest.config.ts`): `test/repo/` and `test/skills/`, 30 s test and hook timeout. `pnpm test` runs everything, `test:ci` adds coverage, `test:watch` watches.
- Time budget: no test file above 15 s summed test time (`pnpm vitest run <path> --reporter=json`, sum of `assertionResults[].duration`). A file above it is cut before new cases are added: per script one happy path, one case per distinct behavior branch, the error cases; data variants of one branch are one `it.each` table on a shared worker or are dropped; fixtures are built once in `beforeAll`.
- Temp files: `test/helpers/pwsh-cache-global.ts` points `TMPDIR`, `TEMP` and `TMP` at a folder of the run and removes it at the end. A process a test starts with its own `env` passes `TMPDIR` on.
- Targeted run: `pnpm vitest run <path>`.
- Script tests with many cases: `PwshWorker` (`test/helpers/pwsh-worker.ts`) starts one pwsh per describe (`beforeAll`/`afterAll`) and runs the script in-process per `await worker.run(args, {cwd, env})` (status/stdout/stderr like a spawn); cases that need their own process (PATH without git, stdin, the invoking process's env) stay single spawns with a comment.
- Resolve repo files from `__dirname` (`path.resolve(__dirname, '../../../skills/<group>/<name>/...')` in `test/skills/<group>/`).
