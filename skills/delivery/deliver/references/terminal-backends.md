# Terminal backends

The deliver scripts call the terminal only through `scripts/TerminalBackend.ps1`. `Get-TerminalBackend` picks the backend: `DELIVER_TERMINAL_BACKEND` (`herdr`, `poimen`, `none`) wins; else `POIMEN_TERMINAL_ID` and `POIMEN_SOCKET` set: `poimen`; else `HERDR_ENV=1`: `herdr`; else `none`. `none` and an unsupported operation are no-ops with one notice per run on stderr; a failing backend call never fails the loop.

| Function                 | herdr                                                      | poimen      | Unsupported  |
| :----------------------- | :--------------------------------------------------------- | :---------- | :----------- |
| `New-LoopWorkspace`      | `herdr workspace create`, `tab rename`, `pane run`         | notice only | poimen, none |
| `Open-LogPane`           | `herdr pane list`, `pane split`, `pane run`, `pane rename` | notice only | poimen, none |
| `Switch-LogPane`         | `herdr pane list`, `pane close` or `Open-LogPane`          | notice only | poimen, none |
| `Test-LoopAgentConflict` | `herdr pane get` (reads the `agent` of the pane)           | none        | poimen, none |

The skills push no display state to the terminal (ADR 0002): no tokens, no agent state. `scripts/Report-Progress.ps1` appends the event and returns; herdr and poimen read the event file (`references/loop.md`, GravionLabs/agent-events). The mapping from events to tokens that the displays apply is checked in as token fixtures: `test/skills/delivery/fixtures/progress-events/<case>.tokens.json` next to `<case>.jsonl` (the deliver profile fixtures: agent-events core events plus `deliver@1`, `references/loop.md`), validated against `schema/progress-tokens.schema.json`. Readers of the events use them as the reference for the five tokens `deliver`, `deliver_step`, `deliver_pr`, `deliver_progress` and `deliver_tone` and the agent state.

## Log pane toggle

`scripts/Switch-LogPane.ps1` toggles the `deliver-log` pane of the active tab. The loop opens that pane itself only with `-LogPane`; by default it colors its own console output, and this toggle shows the log from another pane. herdr has no hide, so it closes the pane, and opens it again below the active pane (last 40 lines of `.agents/deliver-loop.log` under the pane's cwd). Never two in one tab; no log or outside herdr: no pane, exit 0. A keybinding for the user's herdr config (propose it, never write it; `<skill dir>` is the installed `deliver` skill):

```toml
[[keys.command]]
key = "prefix+l"
type = "shell"
command = "pwsh -NoProfile -File <skill dir>/scripts/Switch-LogPane.ps1"
description = "toggle deliver log"
```

`type = "shell"` runs detached from the focused pane's cwd with `HERDR_ACTIVE_TAB_ID`, `HERDR_ACTIVE_PANE_ID` and `HERDR_ACTIVE_PANE_CWD` set; these count as in herdr even without `HERDR_ENV`. With a herdr plugin, `type = "plugin_action"` takes its place and the script reads `HERDR_TAB_ID` and `HERDR_PANE_ID` (with `HERDR_ENV=1`).

## Verified against a live herdr

Checked 2026-11-04 in a spare workspace (closed afterwards) with the herdr CLI of this machine:

- `herdr workspace create --cwd <dir> --label <l> --no-focus` returns `result.tab.tab_id` and `result.root_pane.pane_id` (also `workspace.workspace_id`); `Start-LoopWorkspace.ps1` reads exactly these. `herdr tab rename <tab> <label>` and `herdr pane run <pane> "<command line>"` work as used.

## Quoting for the pane shell

`Start-LoopWorkspace.ps1` quotes the command line for the shell of the new pane: POSIX single quotes for sh, bash, zsh, dash, ksh and fish; doubled single quotes for pwsh and powershell. The shell is `-PaneShell`, else `DELIVER_LOOP_PANE_SHELL`, else the name of `$SHELL` (Windows: pwsh, elsewhere unset: sh). Any other shell (cmd, nu, …) fails before herdr is called with a message, and the shim then runs the loop in the current terminal.
