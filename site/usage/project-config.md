# Project config (.agents/config.json)

`.agents/config.json` is the one committed project configuration that the GravionLabs skills read. Config only: runtime state never lives in `.agents/`. A JSON schema ships with the `implementation` skill (`schema/config.schema.json`); a typo in a top-level key is an error.

## Format override

By default `Format-Changed.ps1 -Language <lang>` runs the built-in commands of `ts`, `ng`, `py`, `dotnet`, `rust` and `go` (named in the `## Format` section of each `<lang>-implementation` skill). The `format` key replaces these commands per language, for example to use JetBrains tools.

## Deliver roles

`deliver.roles` sets `model` and `effort` per role: the `deliver` skill uses `implement`, `review`, `fix` and `release-review` (the release review before the release PR, default opus/high) for its subagents when the harness takes a model per call; the schema also knows `select`, `plan`, `create`, `gate`, `pr` and `ci`, which the skill does not use; `implement` and `fix` also take `tiers` (`fast`, `standard`, `strong`). Unset keys keep the defaults, see `references/roles.md` of the `deliver` skill.

## Release test

`release.prerelease` is the command that cuts a release candidate, for example `gh workflow run release.yml --ref release/next -f prerelease=true`; without it step 9 of `deliver` cuts no RC and the `release-test` comment names `release/next` at its SHA. `release.test.gate` (default `false`): with `true`, `deliver` stops after posting the RC and `github-release finish` refuses while the `release-test` issue is open; with `false` the release PR opens beside the running RC test. See `references/release-review.md` of `deliver`.

`release.test.platforms` (for example `["macOS","Linux","Windows"]`) and `release.test.template` (path of the body template, for example `docs/manual-acceptance.md` or `.github/release-test.md`) make `/github-milestone create M<nnn>` and `insert M<nnn>` also create the `release-test` issue `[PBI] test: release candidate test of M<nnn> on <platforms>` (labels `pbi`, `release-test`, `interactive`; the template with `{milestone}` and `{platforms}` replaced plus a `Tier: interactive` line). `-NoReleaseTest` skips it; a milestone that already has a `release-test` issue gets no second one; without the key nothing is created.

For a desktop app (Tauri) the template says to install the RC next to the stable app: RC and beta builds have their own identifier `<identifier>.rc`, product name `<Name> RC`, own paths and no auto-update (`github-issue` `references/milestones.md`, "Release test").

## Governance

`governance` names where ADRs and specs live and which changes need them. It is read by `adr`, `github-issue`, `planner`, `implementation`, `code-review`, `deliver` and `detect-techstack`, and the CI checks `adr` and `spec` of GravionLabs/ci read the same names. How they work together: [ADRs and specs](governance.md). Without the key, `adr` works on request with `docs/adr` and no change is held to an ADR or spec rule.

- `adrDir`: ADR directory (default `docs/adr`).
- `adrPaths`: globs whose change needs an ADR (default `[]`).
- `specDir`: spec directory (default `docs/specs`).
- `specMap`: glob of source paths to the spec file that describes them.
- `specMode`: `warn` (default) or `require`.
- `skipLabels`: labels that waive the ADR rule (default `["skip-adr"]`).

```json
{
  "governance": {
    "adrDir": "docs/adr",
    "adrPaths": ["docker-compose.yml", "infra/**"],
    "specDir": "docs/specs",
    "specMap": {
      "apps/bff/**": "docs/specs/bff.md",
      "apps/business-backend/**": "docs/specs/business-backend.md",
      "apps/frontend/**": "docs/specs/frontend.md",
      "apps/frontend-canvas/**": "docs/specs/frontend.md",
      "apps/gateway/**": "docs/specs/gateway.md",
      "apps/realtime/**": "docs/specs/realtime.md"
    },
    "specMode": "warn",
    "skipLabels": ["skip-adr"]
  }
}
```

## Contracts

`contracts.paths` lists globs (`**` any depth, `*` within a segment) of the files that other parts depend on: the SPEC, schemas, fixtures, CLI help. After creating the PR (step 6) `deliver` runs `scripts/Test-ContractChange.ps1`, which compares `gh pr diff --name-only` with the globs. On a hit the PBI gets the label `contract-change` (created if missing) and the line `#<nr> pr: contract-change (<n> paths)` is printed. Without the key nothing changes.

```json
{
  "contracts": {
    "paths": ["SPEC.md", "schema/**", "test/fixtures/**", "docs/cli-help.txt"]
  }
}
```

## Schema

```json
{
  "$schema": "https://raw.githubusercontent.com/GravionLabs/skills/main/skills/shared/implementation/schema/config.schema.json",
  "format": {
    "dotnet": {
      "extensions": [".cs"],
      "format": "jb cleanupcode --include={files} MySolution.sln",
      "check": ["jb inspectcode MySolution.sln --include={files} --output=.agents/inspect.xml"]
    }
  }
}
```

- `deliver`: `{ "roles": { "review": { "model": "opus", "effort": "high" } } }`, see above.
- `format`: `false` skips every format and check call (`skipped: disabled`, exit 0), or a map keyed by language (`ts`, `ng`, `py`, `dotnet`, ...), as passed with `-Language` by the language skill. No `format` key keeps the defaults.
- `extensions`: files to keep (optional; absent needs `-Extensions` on the call).
- `format` (entry): command for the format step; `check`: command for the read-only check (what CI or the caller runs). Each is a string or an array run in order; the first non-zero exit stops. `{files}` is replaced by the changed files, repo-relative, one argument each; inside a token (`--include={files}`) the files are joined by `;`.

- `lint`: `false` skips every lint call (`skipped: disabled`), or a map keyed by language. An entry has `command` (string or array, run in order, `{files}` as for `format`; a command without `{files}` runs as it is) and optional `extensions` (absent: those of the built-in default). No `lint` key keeps the per-language default (`references/lint.md` of the `implementation` skill): eslint or biome lint (ts, ng), `ruff check` (py), `dotnet format analyzers` (dotnet), `cargo clippy` (rust), `golangci-lint` (go). `Format-Changed.ps1 -Lint` runs it on the changed files; `code-review` reports the findings.

```json
{
  "lint": {
    "dotnet": {
      "extensions": [".cs"],
      "command": "jb inspectcode MySolution.sln --no-build --include={files} -o=obj/inspect.sarif"
    }
  }
}
```

- `test`: `false` skips every test run (`skipped: disabled`), or a map keyed by language. An entry has `command` (string or array, run in order, the first non-zero exit stops) and optional `targeted` (one string with `{files}`, the test files of a commit's changed paths). Precedence: this key, then `scripts.test` of `package.json` (ts, ng), then the default of the detected tool (vitest `npx vitest run`, jest `npx jest`, `uv run pytest`, `cargo test`, `go test ./...`, `dotnet test`); without any of them the run fails instead of guessing. `Invoke-Tests.ps1` of the `implementation` skill runs it; `implementation` and the `<lang>-test` skills point to it.

```json
{
  "test": {
    "ts": { "command": "npx vitest run", "targeted": "npx vitest run {files}" }
  }
}
```

`/project-setup` (skill `project-setup`) writes the `format` and `lint` keys for you: it asks per detected language for the formatter and the linter and writes only the non-default choices. When ADR or spec folders exist without a `governance` key it also offers that key, with `adrPaths` and `specMap` proposed from the repo and `specMode: warn`; an existing key is shown and only changed on `merge` or `replace`. On request, per editor, it also writes the VS Code files `.vscode/settings.json` (format on save, default formatter per language), `extensions.json`, `tasks.json` (build, test) and `launch.json` (debug starts); an existing file is never changed, the missing entries are shown.

## Precedence

An entry for a language replaces all default commands of that language. With an entry the script runs once per mode with `-Language <lang>` only. It ignores `-Command`/`-Requires`, so a caller that runs the script several times repeats the override commands; keep them idempotent. The script prints a `notice:` on stderr when it runs commands from the file; the file is repo-controlled, review it like code. Languages without an entry keep their defaults; entries for other languages are ignored.

## Migrating from .agents/format.json

Earlier versions read the map directly from `.agents/format.json`. That file still works when `config.json` has no `format` key, with a deprecation notice on stderr. When both exist, `config.json` wins and the notice says so. Move the content under the `format` key and delete the old file.

## Errors

- A configured tool that is not installed is an error (exit 1), never a skip or fallback, even when no file changed.
- An entry without the `format` key (or `check` key in check mode) is an error; there is no fallback to the default command.
- Invalid JSON, an unknown top-level key or a `format` that is neither `false` nor a map is an error naming the file and key.

## Commit the file

`.agents/` also holds installed skills (`.agents/skills`). When the project ignores `.agents/`, ignore its content instead of the directory, so the exception works (`/skills-manage` prints a notice when `.gitignore` ignores `.agents/`):

```gitignore
.agents/*
!.agents/config.json
```

## JetBrains example (.NET)

Install the tools once:

```powershell
dotnet tool install -g JetBrains.ReSharper.GlobalTools
```

- Format: `jb cleanupcode --include={files} MySolution.sln`
- Check: `jb inspectcode MySolution.sln --include={files} --output=.agents/inspect.xml`. `cleanupcode` has no read-only mode: the variant below rewrites the working tree before `git diff --exit-code` fails, so use it only on a tree where that is acceptable (commit or stash first):

```json
{
  "format": {
    "dotnet": {
      "extensions": [".cs"],
      "format": "jb cleanupcode --include={files} MySolution.sln",
      "check": ["jb cleanupcode --include={files} MySolution.sln", "git diff --exit-code"]
    }
  }
}
```

See `references/format.md` of the `implementation` skill for the script parameters.
