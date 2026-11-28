# GravionLabs skills — Working in this repository

GravionLabs/skills is a collection of **skills** (agentskills.io `SKILL.md` format) installed with `npx skills`. Skills load unchanged on Claude Code, OpenCode and GitHub Copilot. Workflows are skills. Successor of GravionLabs/apm-hub (archived).

## Layout

```
skills/<group>/<name>/         # SKILL.md (+ scripts/ references/ templates/ assets/); folder = group, names unique
.claude-plugin/marketplace.json # one plugin per group folder; description by hand, skill list by check-marketplace --fix
skills/delivery/skills-manage/scripts/groups.json   # copy of the groups for the installer (check-marketplace.mjs --fix)
.github/ISSUE_TEMPLATE/        # issue templates (Epic, Feature, PBI, Task, Bug)
scripts/check-marketplace.mjs  # group folders ⇄ marketplace.json ⇄ groups.json; --fix
scripts/generate-skill-list.mjs # site/skill-list.md (gitignored) for the site
scripts/Invoke-ScriptAnalysis.ps1 # PSScriptAnalyzer over skills/, scripts/, .github/
scripts/Link-Skills.ps1        # links skills/<group>/<name> as project skills into .claude/skills/ and .agents/skills/; -Remove
scripts/Invoke-TriggerEvals.ps1 # skill trigger evals (evals/skill-triggers.json, scorer skill-trigger-score.mjs, site/usage/trigger-evals.md)
test/skills/<group>/           # Vitest tests of skill content and scripts
test/repo/ test/helpers/       # repository checks (workflows), shared test helpers
site/                          # VitePress docs site and the public docs (pages: site/**/*.md, see site/README.md)
docs/                          # internal documents only (adr/, spikes/), not published
```

`.claude/`, `.agents/skills/` and `skills-lock.json` are local install state and gitignored, except `.claude/settings.json`: it is committed and holds the allowlist of this repository. `site/skill-list.md` is generated; never commit it. There is no TypeScript build, no manifest per group and no version in any file: a release is a git tag.

## Groups and skills

Groups: `shared`, `delivery`, `github`, `dotnet`, `ts`, `py`, `rust`, `go`, `ng`, `skill-tooling`, `statusline`, `vault`, `school`. The per-group descriptions of the skills live in reference files; read the one of the group you change (also to learn whether a skill already exists):

- Before changing `skills/shared/` (check-prerequisites, implementation, detect-techstack, diagnose, code-review, lessons, project-setup, adr, glossary, ratchet, ast-grep-rules, ui-styleguide, agents-md, secret-scan, prototype, wizard, architecture-survey), read `docs/agents-md-refs/shared.md` (what each skill of the `shared` group does and its constraints).
- Before changing `skills/delivery/` (host-poimen, host-orca, host-claude-code, planner, deliver, deliver-lead, deliver-review, deliver-triage, grill-me, retro, roadmap, skills-manage), read `docs/agents-md-refs/delivery.md` (what each skill of the `delivery` group does and its constraints).
- Before changing `skills/github/` (github-issue, github-pull-request, github-release, github-milestone, github-pages, github-project, github-workflow-lint), read `docs/agents-md-refs/github.md` (what each skill of the `github` group does and its constraints).
- Before changing `skills/dotnet/`, read `docs/agents-md-refs/dotnet.md` (what each skill of the `dotnet` group does and its constraints).
- Before changing `skills/ts/`, read `docs/agents-md-refs/ts.md` (what each skill of the `ts` group does and its constraints).
- Before changing `skills/py/`, read `docs/agents-md-refs/py.md` (what each skill of the `py` group does and its constraints).
- Before changing `skills/rust/`, read `docs/agents-md-refs/rust.md` (what each skill of the `rust` group does and its constraints).
- Before changing `skills/go/`, read `docs/agents-md-refs/go.md` (what each skill of the `go` group does and its constraints).
- Before changing `skills/ng/`, read `docs/agents-md-refs/ng.md` (what each skill of the `ng` group does and its constraints).
- Before changing `skills/skill-tooling/`, read `docs/agents-md-refs/skill-tooling.md` (what each skill of the `skill-tooling` group does and its constraints).
- Before changing `skills/vault/`, read `docs/agents-md-refs/vault.md` (what each skill of the `vault` group does and its constraints).
- Before changing `skills/school/`, read `docs/agents-md-refs/school.md` (what each skill of the `school` group does and its constraints).
- Before changing `skills/statusline/`, read `docs/agents-md-refs/statusline.md` (what each skill of the `statusline` group does and its constraints).

Presets of `skills-manage`: `core` (`shared`, `github`, `delivery`, `statusline`, no stack skills) and `all` (every group except `skill-tooling`).

Every language group provides `<lang>-implementation` (conventions + `## Review rules`) and `<lang>-test`. `detect-techstack` returns their names so `implementation` and `code-review` can dispatch.

## Skill conventions

- Frontmatter: `name`, `description`, optional `license`, optional `metadata`, plus the optional client keys `disable-model-invocation` (paired with `metadata.opencode/autoinvoke: 'false'`), `user-invocable`, `context: fork`, `agent` — see [site/concepts/skill-frontmatter.md](site/concepts/skill-frontmatter.md). Nothing else (no `allowed-tools`, `model`, `compatibility`).
- `SKILL.md` ≤ 100 lines (enforced by `Get-SkillReport.ps1` in CI). Long material goes to `references/` (loaded conditionally), templates to `templates/` or `assets/`, repeatable procedures to `scripts/*.ps1`.
- Shell blocks use ` ```powershell `. Scripts are PowerShell 7+ and are invoked as `pwsh scripts/<Name>.ps1`; paths inside a skill are relative to the skill directory.
- Compose, don't duplicate: one skill owns a workflow, others delegate by name.
- Rules live in `skills/skill-tooling/skill-write/references/skill-writing-rules.md`.

## Issues

The title of an issue starts with its level: `[Epic]`, `[Feature]`, `[PBI]` or `[Bug]`, then the summary (`[PBI] feat: short summary`). There is no Task level: `planner` sends a PBI or Bug to `refine <nr>` or splits it into sibling PBIs; `[Task]` issues of older plans are only read. The shared `issues.yml` workflow of `GravionLabs/ci` sets the prefix from the level label.

## Tests

Tests are Vitest (`pnpm test`; targeted: `pnpm vitest run <path>`), skill tests in `test/skills/<group>/`, repository tests in `test/repo/`. Before adding or changing a test, read `docs/agents-md-refs/tests.md` (layout, 15 s time budget per file, `PwshWorker`).

## Commands

```powershell
pnpm install
pnpm run check                          # local equivalent of the CI checks
pnpm test                               # all tests
pnpm run format:check                   # oxfmt check + oxlint of code, Markdown and YAML (pnpm run format writes; ADR 0006)
pnpm run lint:ps                        # PSScriptAnalyzer (PSScriptAnalyzerSettings.psd1)
node scripts/check-marketplace.mjs --fix   # skill lists of marketplace.json and groups.json from the folders
pnpm run generate                       # site/skill-list.md for the site
pwsh skills/skill-tooling/skill-slim/scripts/Get-SkillReport.ps1 -Root .   # sizes, dangling refs, duplicates
```

## Checks

- Run `check:changed` once when the work is done. It formats, lints, typechecks and tests the changed files and runs the ratchets.
- A pass is cached: an unchanged tree is not checked again. `--base=<ref>` sets the base for stacked work; `GATE_MAX_WORKERS` limits the workers.
- Never skip it and never commit with `--no-verify`.
- Run it in the foreground with a timeout. Failures are printed in full; success prints nothing.

## Adding or changing a skill

1. Use the `skill-write` skill (or copy `assets/skill-template-optimized.md`) under `skills/<group>/<name>/`.
2. Run `node scripts/check-marketplace.mjs --fix`; a new group also needs a plugin entry in `.claude-plugin/marketplace.json`. Update the group `description` in `.claude-plugin/marketplace.json` if the scope changed.
3. Update the group file in `docs/agents-md-refs/` and the table in README.md.
4. Commit with a conventional message (`feat(ng): …`, `refactor(skills): …`). Consumers pick it up with `npx skills update`.

## See also

- [README.md](README.md) — installing skills
- [site/concepts/skill-frontmatter.md](site/concepts/skill-frontmatter.md) — why the frontmatter is restricted
- [CONTRIBUTING.md](CONTRIBUTING.md) — incl. public surface and rename policy
