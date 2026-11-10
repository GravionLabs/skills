# herdr with the skills

[herdr](https://herdr.dev) is a terminal multiplexer for coding agents. It fits the skills for two reasons:

- Parallel worktrees: several `/deliver` sessions run side by side, one worktree and one pane each ([parallel runs](../delivery.md#parallel-runs)).
- Agent state in the sidebar: herdr detects by itself whether an agent works, waits for you or is done.

Nothing here is required. Without herdr the events are still written.

## Events, not pane tokens

`deliver` does not call herdr itself and pushes no pane tokens or agent state. The session (and `Invoke-DeliverLoop.ps1`) sends every progress line as an event through `Report-Progress.ps1`, which only appends it to the event file. The file holds [agent-events](https://github.com/GravionLabs/agent-events) core events (run subject, open tasks, steps, progress, attentions, links) plus the deliver profile; a herdr plugin or poimen reads the core and shows what it wants.

## The loop in herdr

- `deliver-loop` (shim, `Install-LoopShim.ps1`) opens the workspace `<repo> · deliver` (`Start-LoopWorkspace.ps1`) and runs the [loop](deliver.md#a-release-in-fresh-sessions) there in its own pane.
- The log pane `deliver-log` is opt-in with `-LogPane` (the console is already colored); a herdr key toggles it with `Switch-LogPane.ps1`.

Details: `references/terminal-backends.md` and `references/loop.md` of the `deliver` skill.

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
