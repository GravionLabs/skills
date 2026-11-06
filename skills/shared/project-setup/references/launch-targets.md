# Launch targets

The mapping language or framework to start target, build and test command and debugger type. `scripts/New-EditorConfig.ps1 -Editor vscode` turns it into `.vscode/` files, `-Editor zed` into `.zed/` files, `-Editor jetbrains` into `.run/` files. Data: `templates/vscode/targets.json` (formatters, extensions, commands, shared by all editors), `templates/zed/targets.json` (Zed formatters); the start targets are in the script.

| Key (detect-techstack) | Start target                                                              | Build / test                              | Debugger type                          |
| :--------------------- | :------------------------------------------------------------------------ | :---------------------------------------- | :------------------------------------- |
| `dotnet`               | first `*.csproj` that is an executable or web project                     | `dotnet build` / `dotnet test`            | `dotnet` (C# Dev Kit), `projectPath`   |
| `dotnet` + `aspire`    | the `*.csproj` with `Aspire.AppHost.Sdk` (the AppHost)                    | as dotnet                                 | `dotnet`, `projectPath` of the AppHost |
| `ts`, `js`             | script `dev`, else `start` of the root `package.json`                     | `<pm> run build` / `<pm> exec vitest run` | `node` via the package manager         |
| `ng` (ts + angular)    | script `start` (`ng serve`), else `dev`                                   | as ts                                     | `node` via the package manager         |
| ts/ng with Vitest      | extra configuration `Debug Vitest` (`node_modules/vitest/vitest.mjs run`) | -                                         | `node`                                 |
| `py`                   | the current file (`${file}`)                                              | no build / `pytest`                       | `debugpy`                              |
| `rust`                 | `cargo build` then run                                                    | `cargo build` / `cargo test`              | `lldb` (CodeLLDB)                      |
| `go`                   | `${workspaceFolder}` (mode auto)                                          | `go build ./...` / `go test ./...`        | `go` (delve)                           |

`<pm>` is the first of `pnpm`, `yarn`, `bun` in `packageManager` of the report, else `npm`.

## Skipped with a note

- A language outside the table (`java`, ...): no files for it.
- Frameworks `tauri`, `react`, `next`, `vue`, `svelte`: no framework target; the language targets still apply.
- No startable `*.csproj`, no `dev`/`start` script: the language gets tasks and extensions but no start configuration.

## VS Code files

- `settings.json`: `editor.formatOnSave` and per language id `editor.defaultFormatter`: ts/ng `biomejs.biome` or `esbenp.prettier-vscode` (the `format` key of `.agents/config.json`, else the detected tool, else Prettier); py `charliermarsh.ruff`; dotnet `ms-dotnettools.csdevkit`; rust `rust-lang.rust-analyzer`; go `golang.go`.
- `extensions.json`: formatter, language support, `vitest.explorer` with Vitest, `angular.ng-template` for ng, `vadimcn.vscode-lldb` for rust.
- `tasks.json`: `build: <key>` and `test: <key>`. `launch.json`: the start targets.
- An existing file is never changed or merged: the plan shows `missing` (settings keys, extension ids, task labels, configuration names), the user adds them by hand. Comments in the existing file are tolerated for the comparison.

## Zed files

`-Editor zed` writes `.zed/settings.json`, `tasks.json` and `debug.json` from the same mapping (same commands, same start targets, no second mapping).

- `settings.json`: `format_on_save: on` and per Zed language a `formatter`: ts/ng `prettier` or the `biome` language server (same choice as VS Code), py ruff, dotnet OmniSharp, rust rust-analyzer, go gopls (language servers).
- `tasks.json`: array with `build: <key>` and `test: <key>`.
- `debug.json`: array of the start targets with Zed adapters: ts/ng `JavaScript` (dev server, `Debug Vitest`), py `Debugpy`, rust `CodeLLDB`, go `Delve`. dotnet gets no debug entry (Zed has no built-in .NET adapter), with a note.
- An existing file is never changed; the plan shows `missing` (settings keys, task labels, debug labels).

## JetBrains files

`-Editor jetbrains` writes shared run configurations to `.run/<name>.run.xml` (Rider, WebStorm, PyCharm, RustRover and GoLand read them) from the same mapping; templates in `templates/jetbrains/`.

- `build_<key>` and `test_<key>`: shell script configurations with the same commands as the tasks.
- Start targets (debug with the Debug button): the dotnet project (also the Aspire AppHost), the ts/ng npm script (`dev`, else `start`), rust `cargo run`, the go application (project directory).
- py: no file for the start target (current file, JetBrains needs a script path), with a note; build and test stay.
- An existing file is never overwritten; the plan shows `exists`. `.idea/` and plugins are not touched.
