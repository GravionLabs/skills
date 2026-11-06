# Base files

`scripts/Add-BaseFiles.ps1 -ProjectRoot . [-StackJson <report>] [-ImplementationDir <dir>] [-Apply]` prints the plan as JSON; without `-Apply` nothing is written.

## .gitattributes

Template `templates/gitattributes`: `* text=auto eol=lf`; `*.sln *.cmd *.bat *.ps1` `eol=crlf`; `*.png *.jpg *.gif *.ico *.woff *.woff2 *.ttf` `binary`. Missing file: created. Existing file: `gitattributes.missing` lists the absent lines; `-Apply` appends only those, after the user confirmed.

## .gitignore

Per detected language the entries of `templates/gitignore/<lang>.gitignore` (`ts`, `py`, `dotnet`, `rust`, `go`; ts, js and ng use `ts`) that are not yet in the file, appended under a `# <lang> (project-setup)` header. Lines already present are skipped; a second run changes nothing.

## Pre-commit hook

- Only ts/ng/js languages: `hook.action` is `delegate`, `hook.skill` is `setup-biome-husky`, or `setup-prettier-eslint-husky` for Angular or a repository with a prettier config. Run that skill; the script writes nothing.
- Any other language present: one `lefthook.yml` (`templates/lefthook.yml`) for all languages incl. ts. `pre-commit` runs `pwsh <implementation dir>/scripts/Format-Changed.ps1 -Language <lang> -Check -Staged` (only the staged files) per language; `-ImplementationDir` defaults to `.claude/skills/implementation` (use `.agents/skills/implementation` for OpenCode and Copilot installs).
- `.husky/` or `lefthook.yml` exists: `hook.action` is `exists`, reported, nothing changed. No migration from Husky to lefthook.
- `lefthook` not on the PATH: `hook.warnings` carries the install hint (`brew install lefthook`, `winget install evilmartians.lefthook`, `npm i -D lefthook`); it is never installed. The user runs `lefthook install` once.
