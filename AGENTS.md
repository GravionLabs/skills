# GravionLabs skills — Working in this repository

GravionLabs/skills is a collection of **skills** (agentskills.io `SKILL.md` format) installed with `npx skills`. Skills load unchanged on Claude Code, OpenCode and GitHub Copilot. Workflows are skills. Successor of GravionLabs/apm-hub (archived).

## Layout

```
skills/<name>/                 # SKILL.md (+ scripts/ references/ templates/ assets/), flat, names unique
.claude-plugin/marketplace.json # groups: one plugin per group, every skill in exactly one group
skills/skills-install/scripts/groups.json   # copy of the groups for the installer (check-marketplace.mjs --fix)
.github/ISSUE_TEMPLATE/        # issue templates (Epic, Feature, PBI, Task, Bug)
scripts/check-marketplace.mjs  # marketplace ⇄ skill directories ⇄ groups.json; --fix, --add <group> <skill>
scripts/generate-skill-list.mjs # docs/skill-list.md (gitignored) for the site
scripts/Invoke-ScriptAnalysis.ps1 # PSScriptAnalyzer over skills/, scripts/, .github/
test/skills/<group>/           # Vitest tests of skill content and scripts
test/repo/ test/helpers/       # repository checks (workflows), shared test helpers
site/                          # VitePress docs site: renders docs/ in place (see site/README.md)
```

`.claude/`, `.agents/skills/` and `skills-lock.json` are local install state and gitignored. `docs/skill-list.md` is generated; never commit it. There is no TypeScript build, no manifest per group and no version in any file: a release is a git tag.

## Groups and skills

| Group | Skills |
|:--|:--|
| `shared` | `check-prerequisites` (tool check, `-Full`, `-AutoInstall`), `implementation` (every change has tests; dispatches to `<lang>-implementation`; `scripts/Format-Changed.ps1` formats the changed files with per-language default commands; override and `"format": false` in the `format` key of `.agents/config.json`, the project config, schema `schema/config.schema.json`), `detect-techstack` (JSON stack report), `diagnose` (bug fixes: red-capable feedback loop → minimal repro → ranked hypotheses → fix + regression test), `code-review` (review of a diff against acceptance criteria and each language's `## Review rules`; blocking findings vs notes; JSON result `schema/review.schema.json`) |
| `delivery` | `planner`, `deliver` (user-invoked `/deliver <nr> [--unattended]`, harness-neutral: delivers the open PBIs of a PBI, Feature or Epic in dependency order with plain subagents (`implementation`, then `code-review` against the criteria, ≤ 2 fix rounds), PR into `release/next`, `gh pr checks --watch --required`, squash merge, close, then `scripts/Remove-PbiWorktrees.ps1` removes the worktrees and branches of the subagents; state from GitHub only; claims a PBI by assignee so parallel sessions (one worktree each) skip it, `references/claim.md`; pauses ask or, unattended, comment + `needs-decision`; warns when `release/next` has no ruleset; models of its subagents via `deliver.roles` in `.agents/config.json`, `references/roles.md`; the old Claude Code workflow `workflow.js` stays frozen next to it, not started), `grill-me` (interviews the user until no open decision is left; issue number, plan `questions[]` or free description; answers go under `## Decisions`), `retro` (user-invoked run retrospective), `skills-install` (user-invoked installer `scripts/Install-Skills.ps1`: detects the stack, proposes groups, dry run first, then one `npx skills add GravionLabs/skills --skill …` call plus pinned external packs; slash usage `/skills-install [dry-run] [group...] [-g]`; `scripts/groups.json` mirrors the marketplace groups; `references/groups.md`, `references/after-install.md`). Uses `github` and `shared`; stack groups are installed per project. |
| `github` | `github-issue` (routing skill for the Epic→Feature→PBI→Task hierarchy, writes titles as `[<Level>] <summary>`; references for standalone, sub-issues, task issues, conventional commits, release branches), `github-pull-request` (targets the release branch, not `main`; release mode for heads `release/next` and `release/<x.y>` into the default branch needs no issue number, caller `title`, `merged_prs`, optional `feature_number`), `github-release` (cut the rolling `release/next`, finish with the release PR into `main`; read-only state checks in `scripts/Get-ReleaseState.ps1`; owns the git-cliff changelog, `references/cliff-setup.md`; `templates/release-branch.yml` is the caller of the reusable `release-branch.yml` of GravionLabs/ci, offered by `cut`); the project standard skill `github-project` ships from GravionLabs/ci (not in this repository) |
| `dotnet` | `dotnet-implementation`, `dotnet-test`, `dotnet-create-solution`, `dotnet-mcp-server-generator`. `skills-install` adds `dotnet/skills` (`csharp-scripts`, `dotnet-pinvoke`, `nuget-trusted-publishing`) |
| `ts` | `ts-implementation`, `ts-test`, `ts-create-project`, `ts-mcp-server-generator`, `ts-pnpm-workflow`, `setup-biome-husky`, `setup-prettier-eslint-husky` |
| `py` | `py-implementation` (incl. `references/uv-cli.md`), `py-test`, `py-create-project` |
| `rust` | `rust-implementation` (incl. `references/conventions.md`, `references/tauri.md` loaded for framework `tauri`), `rust-test` (incl. `references/mocking-and-properties.md`) |
| `go` | `go-implementation` (package layout, errors, context, `## Review rules`), `go-test` (table-driven, testify, race detector, build tags) |
| `ng` | `ng-implementation` (incl. `references/component.md`, `references/signal-store.md`), `ng-test`, `ng-create-project`, `ng-ag-grid-developer`. `skills-install` adds `angular/skills` (`angular-developer`) |
| `skill-tooling` | `skill-write`, `skill-audit`, `skill-slim` (contributor tooling, not in the `all` preset) |
| `statusline` | Skill `context-statusline` (user-invoked, Claude Code and Copilot CLI: `scripts/statusline.mjs` and `subagent-statusline.mjs` (Claude Code only), Node >= 22, plus `Install-Statusline.ps1 -Client claude|copilot|all` that points `statusLine`/`subagentStatusLine` in `~/.claude/settings.json` and `statusLine` + the `STATUS_LINE` feature flag in `~/.copilot/settings.json` / `$COPILOT_HOME` at the installed skill's own scripts (`~/.claude/skills/...` resp. `~/.agents/skills/...`, no copy, so `npx skills update` refreshes them)). |

Presets of `skills-install`: `core` (`shared`, `github`, `delivery`, `statusline`, no stack skills) and `all` (every group except `skill-tooling`).

Every language group provides `<lang>-implementation` (conventions + `## Review rules`) and `<lang>-test`. `detect-techstack` returns their names so `implementation` and `code-review` can dispatch.

## Skill conventions

- Frontmatter: `name`, `description`, optional `license`, optional `metadata`, plus the optional client keys `disable-model-invocation` (paired with `metadata.opencode/autoinvoke: 'false'`), `user-invocable`, `context: fork`, `agent` — see [docs/concepts/skill-frontmatter.md](docs/concepts/skill-frontmatter.md). Nothing else (no `allowed-tools`, `model`, `compatibility`).
- `SKILL.md` ≤ 100 lines (enforced by `src/generators/skill-size-validator.test.ts`). Long material goes to `references/` (loaded conditionally), templates to `templates/` or `assets/`, repeatable procedures to `scripts/*.ps1`.
- Shell blocks use ` ```powershell `. Scripts are PowerShell 7+ and are invoked as `pwsh scripts/<Name>.ps1`; paths inside a skill are relative to the skill directory.
- Compose, don't duplicate: one skill owns a workflow, others delegate by name.
- Rules live in `skills/skill-write/references/skill-writing-rules.md`.

## Issues

The title of an issue starts with its level: `[Epic]`, `[Feature]`, `[PBI]`, `[Task]` or `[Bug]`, then the summary (`[PBI] feat: short summary`). The shared `issues.yml` workflow of `GravionLabs/ci` sets the prefix from the level label.

## Tests

- Skill content and scripts: `test/skills/<group>/<topic>.test.ts`, `<group>` is the group of the skill under test (`test/helpers/marketplace.ts` reads the groups).
- Repository files outside `skills/` (workflows, `.github/`, `scripts/`): `test/repo/`. Helpers shared by several test directories: `test/helpers/` (no `.test.ts` suffix).
- One Vitest project (`vitest.config.ts`): `test/repo/` and `test/skills/`, 30 s test and hook timeout. `pnpm test` runs everything, `test:ci` adds coverage, `test:watch` watches.
- Time budget: no test file above 15 s summed test time (`pnpm vitest run <path> --reporter=json`, sum of `assertionResults[].duration`). A file above it is cut before new cases are added: per script one happy path, one case per distinct behavior branch, the error cases; data variants of one branch are one `it.each` table on a shared worker or are dropped; fixtures are built once in `beforeAll`.
- Targeted run: `pnpm vitest run <path>`.
- Script tests with many cases: `PwshWorker` (`test/helpers/pwsh-worker.ts`) starts one pwsh per describe (`beforeAll`/`afterAll`) and runs the script in-process per `await worker.run(args, {cwd, env})` (status/stdout/stderr like a spawn); cases that need their own process (PATH without git, stdin, the invoking process's env) stay single spawns with a comment.
- Resolve repo files from `__dirname` (`path.resolve(__dirname, '../../../skills/<name>/...')` in `test/skills/<group>/`).

## Commands

```powershell
pnpm install
pnpm run check                          # local equivalent of the CI checks
pnpm test                               # all tests
pnpm run format:check                   # Biome format + lint (pnpm run format writes)
pnpm run lint:ps                        # PSScriptAnalyzer (PSScriptAnalyzerSettings.psd1)
node scripts/check-marketplace.mjs --fix                 # sync groups.json, drop deleted skills
node scripts/check-marketplace.mjs --fix --add <group> <skill>   # list a new skill
pnpm run generate                       # docs/skill-list.md for the site
pwsh skills/skill-slim/scripts/Get-SkillReport.ps1 -Root .   # sizes, dangling refs, duplicates
```

## Adding or changing a skill

1. Use the `skill-write` skill (or copy `assets/skill-template-optimized.md`) under `skills/<name>/`.
2. Run `node scripts/check-marketplace.mjs --fix --add <group> <name>`; update the group `description` in `.claude-plugin/marketplace.json` if the scope changed.
3. Update the table above and the one in README.md.
4. Commit with a conventional message (`feat(ng): …`, `refactor(skills): …`). Consumers pick it up with `npx skills update`.

## See also

- [README.md](README.md) — installing skills
- [docs/concepts/skill-frontmatter.md](docs/concepts/skill-frontmatter.md) — why the frontmatter is restricted
- [CONTRIBUTING.md](CONTRIBUTING.md) — incl. public surface and rename policy
