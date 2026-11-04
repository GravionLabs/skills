# Status line and subagent status line

The `context-statusline` skill of the `statusline` package (Claude Code; the status line also on GitHub Copilot CLI) shows how full the context is, in the status line
of the main session and per subagent in the agent panel. It keeps the [work an issue by hand](../guides/work-an-issue-by-hand.md) honest: you see the
context grow before the 150k warning fires.

```text
jk@laptop:/repo Opus 4 ctx:42% (84k/200k) (feat/354-statusline) 5h:12% 7d:30%     # statusLine
explorer haiku-4-5 ctx:18% (36k/200k) · scan the hooks package               # subagentStatusLine, one row per subagent
```

Subagent rows show `ctx:<pct>% (<k>k/<size>k)` (only `<k>k` without a window size; fields `tokenCount`, `contextWindowSize`). Colours of `ctx` (rows and main line) with a window size: yellow from 50 % of the window or 250k tokens, red from 80 % or 500k, whichever is lower (200k window: 100k/160k; 1M window: 250k/500k, so 25 %/50 %). Without a size and for `5h`/`7d`: green below 50 %, yellow below 80 %, red above. The main line shows `ctx:<pct>% (<used>k/<size>k)` (`1M` for a 1,000,000 window); without a window size only `ctx:<pct>%`.
Used tokens are the sum of `context_window.current_usage` input and cache fields, else derived from percent and size. Fields are
from the [official statusLine docs](https://code.claude.com/docs/en/statusline) (`context_window.context_window_size`,
`used_percentage`, `current_usage`), verified 2026-10-22. The subagent fields `tokenCount` and `contextWindowSize` come from the same page.

## Install

```powershell
pwsh <skill dir>/scripts/Install-Statusline.ps1 [-Force] [-Uninstall] [-NoContextWarning] [-WhatIf]
```

Or run `/context-statusline` (`/context-statusline help` prints the usage). The installer sets `statusLine` and `subagentStatusLine` in `~/.claude/settings.json` to
`node ~/.claude/skills/context-statusline/scripts/<file>.mjs`: the scripts of the installed skill itself, so `npx skills update`
refreshes the status line and no copy is made. The directory is derived from where the installer runs (a project-scoped
deployment gives that project's path); it refuses when the script is not there. Other keys stay untouched, a
`settings.json.bak-<timestamp>` is written first, and a second run changes nothing. Entries of older versions (copies under
`~/.claude/apm-hub/statusline/`) are migrated and the copies removed. On Windows the home directory is `%USERPROFILE%`, never Git Bash's `HOME` (which can point elsewhere, e.g. `/y/`): the commands carry the absolute path in forward-slash form (`C:/Users/<user>/.claude/...`, quoted when it contains whitespace) instead of `~/...`, and a re-run migrates `~/...` entries the installer wrote earlier; `-Uninstall` recognizes both forms. A `statusLine` you set yourself is replaced
only with `-Force`; `-Uninstall` removes only the entries this installer wrote and old copies, never the skill files.

### Installer details

- No copy: `statusLine` and `subagentStatusLine` become `{"type":"command","command":"node <scripts>/<file>.mjs"}` with `<scripts>` the skill's own `scripts/` directory (written as `~/...` under `$HOME` on Linux/macOS, as the absolute `%USERPROFILE%` path on Windows).
- `<scripts>` is derived from where the installer runs: in a `~/.claude/skills/` or `~/.agents/skills/` deployment each client gets its own copy (Claude Code `~/.claude/skills/context-statusline/scripts`, Copilot CLI `~/.agents/skills/context-statusline/scripts`); anywhere else (a project checkout) the directory it runs from. It refuses when that script is missing (skill deployed for the other client only).
- Every other settings key is kept, `settings.json.bak-<timestamp>` is written before a change, indent is 2 spaces.
- Idempotent; entries of older versions (`apm-hub/statusline/` copies) are migrated and their copies removed; a foreign entry is refused without `-Force`.
- Restart Claude Code (or open a new session) to see the lines.

## Context warning hook

`npx skills` installs no hooks, so the installer registers `scripts/context-warning.sh` of the skill (no copy) unless you pass `-NoContextWarning`:

- Claude Code: `hooks.UserPromptSubmit` in `~/.claude/settings.json`, `{"hooks":[{"type":"command","command":"bash <scripts>/context-warning.sh","timeout":5}]}`.
- Copilot CLI (`-Client copilot|all`): `hooks.postToolUse` in `<copilot home>/settings.json`, `{"type":"command","bash":"bash <scripts>/context-warning.sh","timeoutSec":5}`. Verified live against Copilot CLI 1.0.105: `hooks` in the user `settings.json` are read (same schema as `.github/hooks/*.json`, documented in `copilot help config`), the payload carries `sessionId` but no `transcriptPath`, so the hook reads `${COPILOT_HOME:-~/.copilot}/session-state/<sessionId>/events.jsonl` (on Windows `~` is `USERPROFILE` converted to `/c/...`, not Git Bash's `HOME`).
- Idempotent, foreign hooks are kept, the same backup and `-WhatIf` rules apply; `-Uninstall` removes only our hook entry (and an emptied `hooks` key).

The context size is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens` of the last usage line in the last 2 MB of the transcript (Copilot: the last `session.usage_record`, `inputTokens`). At or above the threshold the hook prints `systemMessage` (the user sees it in Claude Code) and `additionalContext` (the model sees it; on Copilot only the top-level `additionalContext` reaches the model, the nested `hookSpecificOutput` of Claude Code is ignored there; the hook prints both). On Copilot the `systemMessage` is not visible in `-p` mode and unverified interactively, so the user hint there is not guaranteed; the model hint is: finish the step, write a short hand-off, then `/clear` (or `/compact`).

| Variable              | Default  | Meaning                                                               |
| :-------------------- | :------- | :-------------------------------------------------------------------- |
| `CONTEXT_WARN_TOKENS` | `150000` | Context size from which the hook warns                                |
| `CONTEXT_WARN_STEP`   | `100000` | Growth before the next warning; the state resets below the threshold  |
| `CONTEXT_WARN_DEBUG`  | unset    | `1` prints a note on stderr when payload or transcript cannot be read |

Invalid values (non-numeric, empty, more than 9 digits) fall back to the defaults. State lives in `$TMPDIR/<host>-context-warning-<session>`. jq is optional (a bash scanner parses the payload without it); every path exits 0 and nothing touches the network.

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
