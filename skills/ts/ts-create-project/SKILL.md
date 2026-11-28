---
name: ts-create-project
description: 'Scaffold a TypeScript/Node.js project (library, CLI, app) with strict tsconfig, Vitest, ESM and CI. Use when asked to create a new TypeScript or Node.js project.'
disable-model-invocation: true
metadata:
  opencode/autoinvoke: 'false'
---

Scaffold a TypeScript/Node.js project with a production-ready baseline. Paths to `scripts/` and `templates/` are relative to this skill's directory.

## Stack

- **TypeScript** — NodeNext modules, strict mode, `tsc` for builds
- **`tsx`** — run TypeScript directly during development
- **Vitest** — unit tests with globals, v8 coverage
- **Node.js 26 LTS** (`.nvmrc`, `engines.node`); package manager npm or pnpm 12 (a pnpm project pins it in `packageManager`)

## Steps

1. **Ask first:** project name; project type **app** / **library** / **cli**; package manager npm or pnpm
2. **Run the scaffold script:**

   ```powershell
   pwsh scripts/New-NodeProject.ps1 -ProjectName <Name> -ProjectType <app|library|cli> [-PackageManager npm]
   ```

   It creates the directory, copies the templates, patches `package.json`, installs dependencies and initializes git.

3. **CI:** copy `templates/.github/workflows/ci.yml` into the project. It calls the `GravionLabs/ci` reusable Node workflow, which runs the `build` and `test` scripts (`run-lint: false` until a `lint` script exists); for a pnpm project set `package-manager: pnpm`; if the project publishes, confirm the `NPM_TOKEN` secret is configured.
4. **Verify:**

   ```powershell
   npm run build   # tsc — no errors
   npm test        # vitest run — all tests pass
   ```

5. **Next steps:** set up linting and formatting with `setup-oxc-husky`; migrate to pnpm with `ts-pnpm-workflow`

Parameters: `-ProjectName` (required), `-ProjectType` (app/library/cli), `-PackageManager` (npm/pnpm), `-OutputDirectory`

## Templates

| File                       | Purpose                                                                                 |
| -------------------------- | --------------------------------------------------------------------------------------- |
| `package.json`             | ESM baseline: `build`, `dev` (tsx watch), `start`, `test`, `test:ci` (coverage) scripts |
| `tsconfig.json`            | NodeNext module resolution, strict mode, sourceMap, declaration                         |
| `src/index.ts`             | Minimal entry point placeholder                                                         |
| `vitest.config.ts`         | Vitest with `globals: true`, v8 coverage with text + cobertura reporters                |
| `.github/workflows/ci.yml` | GitHub Actions CI via `GravionLabs/ci/.github/workflows/node-package.yml`               |
| `.nvmrc`                   | Node.js version of the project                                                          |
| `.gitignore`               | Node.js standard ignores (dist/, node_modules/, .env)                                   |

## Constraints

- `"type": "module"` (ESM) — no CJS `require()`
- Library projects: `exports`, `types`, `files` fields in `package.json`
- CLI projects: `bin` field and `#!/usr/bin/env node` shebang
- CI: `package.json` must define `test` and `build` scripts; the reusable Node workflow does not read `.nvmrc`, so keep its `node-version` in step with it
- Build and tests must pass before the task is complete
- Workflows reference `GravionLabs/ci` at the major tag `@v<major>` (today `@v1`), never `@main` or a commit SHA; third-party actions stay SHA-pinned where the repository requires it

Report: summary, files created, verify commands.
