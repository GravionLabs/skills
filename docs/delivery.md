# Delivery

Reference for the skill `deliver` (group `delivery`), the same on Claude Code, OpenCode and Copilot CLI. New to it? Start with the [step-by-step guide](guides/deliver.md).

`deliver` delivers the open PBIs and Bugs (labels `pbi`, `bug`) of the given issues in dependency order, each once. Per PBI: a subagent implements (`implementation`), a subagent reviews (`code-review`), at most 2 fix rounds, PR into `release/next`, required checks, squash merge without asking, issue closed. State lives in GitHub only, so running it again resumes.

## Options

| Option                 | Meaning                                                                                                                                                                              |
| :--------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<nr> [<nr> …]`        | PBI, Bug, Feature or Epic numbers; each open PBI or Bug below them is delivered once. Missing: asked once.                                                                           |
| `--milestone <name>`   | Adds the open PBIs and Bugs of the milestone. When all are delivered, a release review runs and `github-release finish` opens the release PR into `main`; `deliver` never merges it. |
| `--unattended`         | Never asks: a pause comments on the issue, adds `needs-decision` and goes on. Default is interactive: a pause or blocked PBI asks in the chat.                                       |
| `--max <n>`            | Stops after `n` delivered, blocked or paused PBIs and prints the report.                                                                                                             |
| `help`, `--help`, `-h` | Prints the usage (`references/help.md`).                                                                                                                                             |

Skipped: `needs-decision`, `needs-refinement` (hint `planner refine <nr>`), `interactive` (unattended only) and PBIs claimed by another session. A missing breakdown is planned with `planner` and `grill-me` ([plan an issue](guides/plan-an-issue.md)).

The hard gate is a GitHub ruleset on `release/next` (required checks, no bypass): a red check blocks the merge whatever the session does. `deliver` warns at the start when the repository has none.

## A release in fresh sessions

See the [guide](guides/deliver.md#a-release-in-fresh-sessions). `pwsh <skill-dir>/scripts/Invoke-DeliverLoop.ps1 -Milestone <name> [-Max <n>] [-Model sonnet]` runs `claude -p "/deliver … --unattended --max 1"` in a fresh process per PBI, so no session grows over a whole release. It reads the progress from GitHub (done, blocked, no progress, max reached), writes a stream log to `.agents/deliver-loop/` and shows the progress in herdr. Details: `references/loop.md` of the `deliver` skill.

## Review result file

After every review round `deliver` writes the result to `<git-common-dir>/.agents/state/review-<nr>.json` (`git rev-parse --git-common-dir`, so the same file from every worktree; never committed). The next round overwrites it. It holds `pbi`, `branch`, `sha` (reviewed head), `round`, `unmet[]` and `review` (the `code-review` result) and validates against `skills/delivery/deliver/schema/deliver-review.schema.json`. Tools outside the session, such as a herdr plugin, can read it.

## Release review

Before `deliver` opens the release PR of a `--milestone`, a subagent (role `release-review`, default opus/high, overridable in `deliver.roles`) reviews the whole release diff `origin/main...origin/release/next` with `code-review` against the acceptance criteria of the milestone's closed PBIs and Bugs. Each PBI was reviewed alone; this review looks for what only shows across PBIs, such as contract drift between skills or a hand-off one PBI promises and another never fills. The result goes to `<git-common-dir>/.agents/state/release-review-<milestone>.json` (schema `skills/delivery/deliver/schema/deliver-release-review.schema.json`).

- Blocking findings: one `[Bug] fix: …` issue per finding in the milestone (`Related: #<PBI>`, marker `Found in release review round <n>`), no release PR, `release: <n> blocking → #a, #b`. Interactive mode shows the findings and asks before filing; unattended files them. The next `/deliver --milestone <name>` delivers the bugs and reviews again.
- At most 2 rounds per milestone: a third round with blocking findings pauses (interactive: asks; unattended: comment and `needs-decision` on the milestone's last PBI).
- No blocking finding: up to 5 notes go into the release PR body as `## Release review notes`.

Details: `references/release-review.md` of the `deliver` skill. A manual `github-release finish` has no release review.

## Decision PBIs and spec notes

With the `governance` key in `.agents/config.json`, a PBI with the label `needs-decision` and the ADR criterion is a decision PBI. `deliver` skips it (`#<nr> select: decision, write the ADR with adr`) and lists it under paused; PBIs it blocks wait. You write the ADR with the `adr` skill, accept it, remove `needs-decision` and merge the ADR PR (with `Closes #<nr>`) into `release/next`, then close the decision PBI by hand (`gh issue close <nr> --comment "Decided in #<pr>"`), because `Closes` does not fire there; `/deliver` then continues. A `no spec change needed: <spec>` line in the implementer notes reaches the PR body as a `## Spec` section before `## Review notes`, and the review gets the issue labels and notes to apply `skipLabels` and the spec notes. Details: `references/governance.md` of the `deliver` skill; the whole flow from the key to CI: [ADRs and specs](usage/governance.md).

## Parallel runs

Several sessions can run `/deliver` at the same time, one worktree per session (`claude --worktree`; `git worktree add` for OpenCode and Copilot CLI) and on independent issues. Each session claims the PBI it announces by assigning it (`gh issue edit <nr> --add-assignee @me`) and releases the claim when the PBI is merged, blocked or paused. Selection through a Feature or Epic skips a PBI that is assigned and whose branch was pushed within the last hour; a stale claim (older branch, no open PR activity) is taken over. `/deliver <nr>` on the PBI itself continues it regardless of the claim. Details: `references/claim.md` of the `deliver` skill.

## herdr

`deliver` reports its progress as pane tokens in a [herdr](https://herdr.dev) sidebar. Tokens, layout and plugins: [herdr with the skills](guides/herdr.md).

Without `/deliver` you work interactively, see [Work an issue by hand](guides/work-an-issue-by-hand.md).

## Models

Models of the `/deliver` subagents (where the harness takes one per call) are set with `deliver.roles` in `.agents/config.json`, see the `deliver` skill (`references/roles.md`).
