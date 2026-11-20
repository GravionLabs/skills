# herdr with the skills

[herdr](https://herdr.dev) is a terminal multiplexer for coding agents. It fits the skills for two reasons:

- Parallel worktrees: several `/deliver` sessions run side by side, one worktree and one pane each ([parallel runs](../delivery.md#parallel-runs)).
- Agent state in the sidebar: herdr detects by itself whether an agent works, waits for you or is done.

Nothing here is required. Without herdr the events are still written.

## Events, not pane tokens

`deliver` does not call herdr itself and pushes no pane tokens or agent state through a backend; the loop only reports its state with the open OSC 7501 sequence (ADR 0007, off with `DELIVER_PROGRAM_STATUS=0`). The loop (`deliver-loop`) writes its progress as events to the event file. The file holds [agent-events](https://github.com/GravionLabs/agent-events) core events (run subject, open tasks, steps, progress, attentions, links) plus the deliver profile; a herdr plugin or poimen reads the core and shows what it wants.

## The loop in herdr

`deliver-loop` ([launcher](deliver.md#the-deliver-loop-command)) runs in the pane you start it in; it opens no workspace of its own. Its progress is in the event file, its log in `<git-common-dir>/deliver/loop.log`.

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

Add `worktree-cleanup` for parallel runs.
