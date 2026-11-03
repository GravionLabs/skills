# herdr with the skills

[herdr](https://herdr.dev) is a terminal multiplexer for coding agents. It fits the skills for two reasons:

- Parallel worktrees: several `/deliver` sessions run side by side, one worktree and one pane each ([parallel runs](../delivery.md#parallel-runs)).
- Agent state in the sidebar: herdr detects by itself whether an agent works, waits for you or is done, and `deliver` adds what it is doing.

Nothing here is required. Without herdr `deliver` skips the display.

## Pane tokens and sidebar layout

In a herdr pane, `deliver` (and `Invoke-DeliverLoop.ps1`) reports its progress as pane tokens of source `deliver`: `deliver` (issue), `deliver_step` (step and result) and `deliver_pr` (PR), cleared at the end. The agent name in the sidebar stays the harness. herdr shows a token only where a row of `[ui.sidebar.agents]` names it. Copy this into your herdr config:

```toml
[ui.sidebar.agents]
rows = [
  ["state_icon", { token = "tab", bold = true }, { token = "state_text", rules = [{ equals = "done", fg = "#5f5" }, { equals = "blocked", fg = "#f55" }] }],
  ["agent", "workspace"],
  [{ token = "$deliver", bold = true }, { token = "$deliver_step", rules = [{ contains = "blocked", fg = "#f55" }, { contains = "merged", fg = "#5f5" }] }, "$deliver_pr"],
]
```

Alternatives (compact two-line layout, `deliver` line first, `row_gap = 1`) are in `references/herdr.md` of the `deliver` skill. No bus or daemon is involved.

## The loop in herdr

- `deliver-loop` (shim, `Install-LoopShim.ps1`) opens the workspace `<repo> · deliver` (`Start-LoopWorkspace.ps1`) and runs the [loop](deliver.md#a-release-in-fresh-sessions) there in its own pane.
- The loop reports its own agent state with `report-agent --source deliver-loop` (`working`, `blocked`, `idle`, then `release-agent`).
- The log pane `deliver-log` is opt-in with `-LogPane` (the console is already colored); a herdr key toggles it with `Switch-LogPane.ps1`.

Details: `references/herdr.md` and `references/loop.md` of the `deliver` skill.

## Plugins

[GravionLabs/herdr-plugins](https://github.com/GravionLabs/herdr-plugins) holds herdr plugins for this workflow. Each installs on its own:

```bash
herdr plugin install GravionLabs/herdr-plugins/<plugin>
```

| Plugin             | Purpose                                                                          |
| :----------------- | :------------------------------------------------------------------------------- |
| `deliver-starter`  | Starts `/deliver` from a popup or an issue link, in a herdr worktree or the loop |
| `deliver-board`    | Popup with the open PBIs, claims and PR state of `release/next`                  |
| `deliver-view`     | Agent view with the `deliver` sessions first, blocked ones on top                |
| `review-popup`     | Shows the last `deliver` review of the current branch                            |
| `deliver-log`      | Shows or hides the log pane of `Invoke-DeliverLoop.ps1`                          |
| `agent-notify`     | Notification when an agent pane turns done or blocked                            |
| `worktree-cleanup` | Removes worktrees and branches of merged PBIs                                    |
| `layout-bootstrap` | Opens a project workspace with agent, test and log panes                         |
| `command-palette`  | Popup to search and run plugin actions and own commands with one key             |
| `repo-open`        | Opens a repository in a workspace                                                |
| `link-trim`        | Opens links without trailing `)`, `.`, `,` picked up by URL detection            |

The README of the repository is the source for the current list and status.

## Recommended starter set

For `/deliver` users:

```bash
herdr plugin install GravionLabs/herdr-plugins/deliver-starter
herdr plugin install GravionLabs/herdr-plugins/deliver-board
herdr plugin install GravionLabs/herdr-plugins/review-popup
herdr plugin install GravionLabs/herdr-plugins/agent-notify
```

Add `deliver-log` when you run the [loop](deliver.md#a-release-in-fresh-sessions) and `worktree-cleanup` for parallel runs.
