# Objectives

An `[Objective]` (label `objective`) is the level above the Epic, an outcome that spans several Epics or Features, also in other repositories of the same owner. It names the outcome, never the implementation.

## Body

- `## Outcome`: what is true when it is done.
- `## Affected repos`: `<owner>/<repo>` list.
- `## Requires`: one line per prerequisite, see below.
- `## Acceptance Criteria`: a checklist a human verifies.
- Children are native sub-issues (Features or Epics, `sub-issues.md`), not a checklist. No implementation details.
- Planned with `planner <owner/repo#nr>`: Features in the target repositories, created and linked by `create-from-plan.md`.

## Requires

`Requires: <owner>/<repo>@<milestone> released|rc`

- `released`: the milestone is closed (`github-milestone close`).
- `rc` (the normal case): the `release-test` issue of the milestone carries the marker `<!-- release-test-rc -->`.
- Code dependencies between issues stay native `blocked-by` links, never `Requires`.

## Runner marker

One comment per Objective, replaced in place, never a second one:

`<!-- objective-runner: host=<machine|cloud-id> since=<iso> heartbeat=<iso> -->`

`host` is the machine or cloud id that runs the Objective, `since` the start, `heartbeat` the last sign of life (ISO 8601, UTC). A heartbeat older than 30 minutes is dead. `deliver-loop -Objective` sets the marker, refreshes the heartbeat every 10 minutes and hands over with `deliver-loop takeover <objective> [-Force]` or `deliver-loop release <objective>` (`deliver` `references/loop.md`, Objective).

## Closing

When all children are closed, a human checks the Acceptance Criteria and closes the Objective. No skill closes it.

## Milestones

An Objective never has a milestone (`milestones.md`); `github-milestone assign` refuses it like an Epic.
