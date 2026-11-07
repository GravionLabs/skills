# Milestones and the issue levels

A milestone is a release and holds the work items that are delivered. The rule is written here once; `planner`, `roadmap`, `deliver` and `github-milestone` follow and check it.

| Level   | Milestone                                                          |
| :------ | :----------------------------------------------------------------- |
| PBI     | Always: the milestone it is delivered in.                          |
| Bug     | Always: the milestone it is delivered in.                          |
| Feature | Only when all its PBIs are in that same milestone, otherwise none. |
| Epic    | Never.                                                             |

Why: `deliver --milestone` takes the open PBIs and Bugs of the milestone plus the work items below the Features in it. A Feature in the milestone with PBIs outside of it pulls those in, and they then do not count in the milestone progress. `deliver` therefore skips such an item (`#<nr> select: outside M<n>, skipped`); `/deliver <feature>` without `--milestone` delivers all its PBIs as before.

## Release test

One `release-test` per milestone (label `pbi` + `release-test`, usually `interactive`): the manual platform test on the release candidate. Rule: one `release-test` per milestone, always last, never a gate. A gate setting is introduced by #378 (not yet implemented): today the RC test never blocks the loop. `deliver` selects it only when it is the last open `pbi`/`bug` of the milestone (an implicit blocked-by, no links needed on the other issues); `interactive` stays on it so unattended runs skip it.

## Closing

Closing does not depend on the milestone. After the release PR is merged into `main`, `close-release-issues` (GravionLabs/ci) closes the issues with `Closes #n`, their open sub-issues, and the PBI or Feature parents whose sub-issues are all closed, repeating upwards. An Epic is never closed this way.

## Checks

- `github-milestone` `current` and `<name>` list a `warnings` group: an Epic in the milestone; a Feature in it with open sub-issues outside of it (with their milestone or `none`).
- `roadmap` (`Set-IssueMilestones.ps1`) refuses an Epic and a Feature whose open PBIs would not all be in its milestone; nothing is written then.
- Fix a warning by moving the PBIs into the milestone or clearing the milestone of the Feature or Epic.
