# Launch targets

The mapping language or framework to start target, build and test command and debugger type. `scripts/New-EditorConfig.ps1 -Editor vscode` turns it into `.vscode/` files; Zed and JetBrains reuse the same mapping. Data: `templates/vscode/targets.json` (formatters, extensions, commands); the start targets are in the script.

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
