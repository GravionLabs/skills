# /context-statusline

## Usage

`/context-statusline [-Client claude|copilot|all] [-Force] [-Uninstall] [-WhatIf]`

Runs `pwsh scripts/Install-Statusline.ps1` with the given parameters. Without arguments it installs for Claude Code.

## Arguments and flags

- `-Client claude|copilot|all`: client to configure (default `claude`). Copilot CLI gets the status line only.
- `-Force`: replace a `statusLine` / `subagentStatusLine` you set yourself.
- `-Uninstall`: remove only the entries of this skill (and copies of older versions).
- `-WhatIf`: show what would change, write nothing.
- `help` (or `--help`, `-h`): print this text.

What you get:

- Status line (`statusline.mjs`): `user@host:dir`, model, `ctx:<pct>% (<used>k/<size>k)`, `(git branch)`, `5h:<pct>% 7d:<pct>%`. Null or missing fields are skipped.
- Subagent line (`subagent-statusline.mjs`, Claude Code only): one row per subagent with type, model, `ctx:<pct>%` and label.

Requires Node >= 22 and PowerShell 7+. Both scripts run on every refresh: no network, always exit 0.

## Examples

- `/context-statusline -WhatIf`: preview the change for Claude Code.
- `/context-statusline`: install for Claude Code.
- `/context-statusline -Client all`: install for Claude Code and Copilot CLI.
- `/context-statusline -Force`: replace your own status line entries.
- `/context-statusline -Uninstall`: remove the entries again.

## Config

Settings are written, not read from `.agents/config.json`: Claude Code `~/.claude/settings.json`; Copilot CLI `~/.copilot/settings.json` (or `$COPILOT_HOME/settings.json`). A `settings.json.bak-<timestamp>` is written first, other keys are kept. Restart the client to see the lines.

## See also

- `npx skills update` refreshes the scripts (the settings point at the installed skill, no copy).
- Docs: https://github.com/GravionLabs/skills/blob/main/docs/usage/statusline.md
