# Delivery

Delivery runs through the skill `deliver` (group `delivery`), the same on Claude Code, OpenCode and Copilot CLI: `/deliver <nr> [<nr> …] [--milestone <name>]` takes the open PBIs of PBIs, Features, Epics or a milestone in dependency order (each once; `needs-refinement` is skipped); per PBI a subagent implements with `implementation`, a subagent reviews with `code-review`, at most 2 fix rounds follow, then the PR into `release/next`, the wait for the required checks, the squash merge and the closed issue. State lives in GitHub only, so `/deliver <nr>` resumes a stopped run. A missing breakdown is planned with `planner` and `grill-me` in the same session.

Interactive by default: an unclear criterion, extra scope or a blocker asks you in the chat. `/deliver <nr> --unattended` (`claude -p`, `opencode run`, `copilot -p`) comments on the issue instead, labels it `needs-decision` and continues with the next independent PBI.

The hard gate is a GitHub ruleset on `release/next` (required checks, no bypass): a red check blocks the merge whatever the session does. `deliver` warns at the start when the repository has none. The Claude Code workflow `workflow.js` of an earlier version stays frozen next to the skill until a retro decides on it.

## A release in fresh sessions

`pwsh <skill-dir>/scripts/Invoke-DeliverLoop.ps1 -Milestone <name> [-Max <n>] [-Model sonnet]` runs `claude -p "/deliver … --unattended --max 1"` in a fresh process per PBI, so no session grows over a whole release. It reads the progress from GitHub (done, blocked, no progress, max reached), writes a stream log to `.agents/deliver-loop/` and shows the progress in herdr. Details: `references/loop.md` of the `deliver` skill.

## Parallel runs

Several sessions can run `/deliver` at the same time, one worktree per session (`claude --worktree`; `git worktree add` for OpenCode and Copilot CLI) and on independent issues. Each session claims the PBI it announces by assigning it (`gh issue edit <nr> --add-assignee @me`) and releases the claim when the PBI is merged, blocked or paused. Selection through a Feature or Epic skips a PBI that is assigned and whose branch was pushed within the last hour; a stale claim (older branch, no open PR activity) is taken over. `/deliver <nr>` on the PBI itself continues it regardless of the claim. Details: `references/claim.md` of the `deliver` skill.

## herdr

In a [herdr](https://herdr.dev) pane, `deliver` shows its current step in the herdr Agent sidebar (`references/herdr.md` of the skill). herdr detects whether the agent waits for you by itself; no bus or daemon is involved.

Without `/deliver` you work interactively, see [Working mode](working-mode.md).

## Models

Models of the `/deliver` subagents (where the harness takes one per call) are set with `deliver.roles` in `.agents/config.json`, see the `deliver` skill (`references/roles.md`).
