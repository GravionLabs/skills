---
name: project-setup
description: 'Set up a project: ask per detected language for the formatter and linter and write the format and lint keys of .agents/config.json, create .editorconfig. Use for "/project-setup", "set up formatting or linting" or a new repository.'
disable-model-invocation: true
metadata:
  opencode/autoinvoke: 'false'
---

User-invoked: `/project-setup [dry-run]`. It detects the stack, lets the user pick the formatter and the linter per language and writes only what differs from the defaults. Paths are relative to this skill's directory; run the script from the project root.

## Steps

1. Dry run first (always, also without the `dry-run` argument). `Set-ProjectSetup.ps1` runs `detect-techstack` and prints the plan as JSON; nothing is written:

   ```powershell
   pwsh scripts/Set-ProjectSetup.ps1 -ProjectRoot .
   ```

2. Show the user, per entry of `languages`: the default (`default`), the detected tool (`detected`), and the `options`; the same per language for the linter under `languages[].lint`. Ask which to use per language (one question, all formatters and linters). Options: the default, the other tools (`biome` or `prettier-eslint` for ts/ng), JetBrains `jb cleanupcode` (dotnet), or `custom` (a format and a read-only check command). Linters: the default (eslint or biome, ruff, dotnet analyzers, clippy, golangci-lint), `oxlint` (ts/ng), `pyright` or `mypy` (py), JetBrains `jb inspectcode` (dotnet), or `custom` (one lint command).
3. Run the dry run again with the answers, `-Choice 'dotnet=jb','ts=biome'` and `-LintChoice 'dotnet=jb','py=pyright'`; for `custom` add `-FormatCommand 'py=<cmd>' -CheckCommand 'py=<cmd>'` resp. `-LintCommand 'py=<cmd>'`. `languages[].lint.entry` is what is written under `lint`. Show `languages[].entry` (what is written), `editorconfig.action` and `warnings`.
4. Tool in `warnings` (e.g. `jb`): report it with its install hint (`dotnet tool install -g JetBrains.ReSharper.GlobalTools`); never install it. Ask whether to continue.
5. `dry-run` argument: stop here. Otherwise ask for confirmation, then repeat the same call with `-Apply`.
6. Report what was written: `format` and `lint` (`written`, `unchanged`, `skipped: ...`) and `editorconfig.result`.

## What is written

- `.agents/config.json`, key `format`: only entries of non-default choices. Other keys stay, an entry of another language stays, `"format": false` is respected (skipped). A new file gets `$schema`. Schema: `schema/config.schema.json` of `implementation`, docs `docs/usage/project-config.md`.
- `.agents/config.json`, key `lint`: the same for linters (`{ "command": ..., "extensions": [...] }`); `"lint": false` is respected. Runner and defaults: the lint reference of `implementation`.
- `.editorconfig`: the dotnet template (`templates/dotnet.editorconfig`, also used by `dotnet-create-solution`) or `templates/base.editorconfig`, plus `templates/sections/<lang>.editorconfig` for ts/ng, py, rust and go. An existing file is never overwritten: `editorconfig.diff` shows the difference, the user merges by hand.

## Gotchas

- `jb cleanupcode` has no read-only mode: its entry keeps `dotnet format --verify-no-changes` as `check`. It needs a `*.slnx` or `*.sln` in the root.
- A choice for a language that is not detected, an unknown option or `custom` without both commands is an error (exit 1). Invalid JSON in `.agents/config.json` stops the run.
- ts/ng entries of `prettier-eslint` and `biome` run on one extension list (the eslint extensions resp. plus json, css, html, md, yaml for biome).
- `jb inspectcode` writes SARIF (`obj/inspect.sarif`) and needs a `*.slnx` or `*.sln` in the root; whether it exits non-zero on findings is not verified.
- More setup parts (governance, base files, editor configs) follow the same pattern in the script: one plan function and one apply function per part.
