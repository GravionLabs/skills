# Project config (.agents/config.json)

`.agents/config.json` is the one committed project configuration that the GravionLabs skills read. Config only: runtime state never lives in `.agents/`. A JSON schema ships with the `implementation` skill (`schema/config.schema.json`); a typo in a top-level key is an error.

## Format override

By default `Format-Changed.ps1 -Language <lang>` runs the built-in commands of `ts`, `ng`, `py`, `dotnet`, `rust` and `go` (named in the `## Format` section of each `<lang>-implementation` skill). The `format` key replaces these commands per language, for example to use JetBrains tools.

## Deliver roles

`deliver.roles` sets `model` and `effort` per role: the `deliver` skill uses `implement`, `review` and `fix` for its subagents when the harness takes a model per call; the schema also knows `select`, `plan`, `create`, `gate`, `pr` and `ci`, which the skill does not use; `implement` and `fix` also take `tiers` (`fast`, `standard`, `strong`). Unset keys keep the defaults, see `references/roles.md` of the `deliver` skill.

## Governance

`governance` names where ADRs and specs live and which changes need them. The `adr` skill and `github-issue` read it; the CI check of GravionLabs/ci reads the same names. Without the key, `adr` works on request with `docs/adr` and no change is held to an ADR or spec rule.

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

## Precedence

An entry for a language replaces all default commands of that language. With an entry the script runs once per mode with `-Language <lang>` only. It ignores `-Command`/`-Requires`, so a caller that runs the script several times repeats the override commands; keep them idempotent. The script prints a `notice:` on stderr when it runs commands from the file; the file is repo-controlled, review it like code. Languages without an entry keep their defaults; entries for other languages are ignored.

## Migrating from .agents/format.json

Earlier versions read the map directly from `.agents/format.json`. That file still works when `config.json` has no `format` key, with a deprecation notice on stderr. When both exist, `config.json` wins and the notice says so. Move the content under the `format` key and delete the old file.

## Errors

- A configured tool that is not installed is an error (exit 1), never a skip or fallback, even when no file changed.
- An entry without the `format` key (or `check` key in check mode) is an error; there is no fallback to the default command.
- Invalid JSON, an unknown top-level key or a `format` that is neither `false` nor a map is an error naming the file and key.

## Commit the file

`.agents/` also holds installed skills (`.agents/skills`). When the project ignores `.agents/`, ignore its content instead of the directory, so the exception works (`/skills-install` prints a notice when `.gitignore` ignores `.agents/`):

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
