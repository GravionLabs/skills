# Status line and subagent status line

The `context-statusline` skill of the `statusline` package (Claude Code; the status line also on GitHub Copilot CLI) shows how full the context is, in the status line
of the main session and per subagent in the agent panel. It keeps the [working mode](../working-mode.md) honest: you see the
context grow before the 150k warning fires.

```text
jk@laptop:/repo Opus 4 ctx:42% (84k/200k) (feat/354-statusline) 5h:12% 7d:30%     # statusLine
explorer haiku-4-5 ctx:18% (36k/200k) · scan the hooks package               # subagentStatusLine, one row per subagent
```

Subagent rows show `ctx:<pct>% (<k>k/<size>k)` (only `<k>k` without a window size; fields `tokenCount`, `contextWindowSize`). Colours (also for `ctx` and `5h`/`7d` on the main line): green below 50 %, yellow below 80 %, red above. The main line shows `ctx:<pct>% (<used>k/<size>k)` (`1M` for a 1,000,000 window); without a window size only `ctx:<pct>%`.
Used tokens are the sum of `context_window.current_usage` input and cache fields, else derived from percent and size. Fields are
from the [official statusLine docs](https://code.claude.com/docs/en/statusline) (`context_window.context_window_size`,
`used_percentage`, `current_usage`), verified 2026-10-22. The subagent fields `tokenCount` and `contextWindowSize` come from the same page.

## Install

```powershell
pwsh <skill dir>/scripts/Install-Statusline.ps1 [-Force] [-Uninstall] [-WhatIf]
```

Or run `/context-statusline`. The installer sets `statusLine` and `subagentStatusLine` in `~/.claude/settings.json` to
`node ~/.claude/skills/context-statusline/scripts/<file>.mjs`: the scripts of the installed skill itself, so `npx skills update`
refreshes the status line and no copy is made. The directory is derived from where the installer runs (a project-scoped
deployment gives that project's path); it refuses when the script is not there. Other keys stay untouched, a
`settings.json.bak-<timestamp>` is written first, and a second run changes nothing. Entries of older versions (copies under
`~/.claude/apm-hub/statusline/`) are migrated and the copies removed. A `statusLine` you set yourself is replaced
only with `-Force`; `-Uninstall` removes only the entries this installer wrote and old copies, never the skill files.

### Installer details

- No copy: `statusLine` and `subagentStatusLine` become `{"type":"command","command":"node <scripts>/<file>.mjs"}` with `<scripts>` the skill's own `scripts/` directory (written as `~/...` under `$HOME`).
- `<scripts>` is derived from where the installer runs: in a `~/.claude/skills/` or `~/.agents/skills/` deployment each client gets its own copy (Claude Code `~/.claude/skills/context-statusline/scripts`, Copilot CLI `~/.agents/skills/context-statusline/scripts`); anywhere else (a project checkout) the directory it runs from. It refuses when that script is missing (skill deployed for the other client only).
- Every other settings key is kept, `settings.json.bak-<timestamp>` is written before a change, indent is 2 spaces.
- Idempotent; entries of older versions (`apm-hub/statusline/` copies) are migrated and their copies removed; a foreign entry is refused without `-Force`.
- Restart Claude Code (or open a new session) to see the lines.

## GitHub Copilot CLI

Copilot CLI has an experimental `statusLine` and no subagent equivalent. `Install-Statusline.ps1 -Client copilot` (or `all`):

- sets `statusLine` to `{"type":"command","command":"node ~/.agents/skills/context-statusline/scripts/statusline.mjs","padding":1}` in `~/.copilot/settings.json` (or `$COPILOT_HOME/settings.json`): the Copilot deployment of the skill, which must exist (run from the `~/.claude/skills/` copy the installer still picks `~/.agents/skills/` for Copilot and refuses when it is missing)
- adds `STATUS_LINE` once to `feature_flags.enabled`, keeping other flags and keys
- same backup, idempotency, `-Force` and `-WhatIf` rules as for Claude Code; `-Uninstall` removes the entry and script but leaves the `STATUS_LINE` flag (another status line may rely on it)

The script prefers `context_window.current_context_used_percentage` (matches `/context`) over `used_percentage`. Copilot sends no
`rate_limits`, so `5h`/`7d` is omitted; the size part appears only if Copilot sends `context_window_size`. The Copilot payload fields (`cwd`, `session_id`, `model.id`, `model.display_name`,
`workspace.current_dir`, `context_window.*` incl. `context_window_size`, `cost.total_premium_requests`) are taken from community guides, not from official
documentation, and may change while the feature is experimental.

## Requirements and behaviour

- Node 22 or newer at run time; no packages. The same command works on Linux, macOS and Windows (`~` and `/` are expanded
  by Claude Code, through Git Bash if present, else PowerShell). The installer needs PowerShell 7+.
- The scripts run on every refresh: no network, `git --no-optional-locks` with a 1 s timeout, always exit 0. Missing or
  null fields are skipped; garbage on stdin gives defaults (status line) or no output (subagent line).
