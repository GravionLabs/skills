---
name: github-milestone
description: 'Show the milestones (releases) of a repository: the current one with the state of its issues, all with progress, or one by name; create x.y.z; close x.y.z after its release tag. Use for "/github-milestone current", "list the milestones" or "show milestone 1.2.0".'
---

Shows the milestones of the repository as tables in the chat. A milestone is a release: its title is the bare version `x.y.z`, the release tag is `v<x.y.z>`. `deliver --milestone <name>` delivers one, `github-release` owns the branches and the release PR. Paths are relative to this skill's directory.

Prerequisites: `gh` authenticated, run from the repository root. Usage: `/github-milestone current|list|<name>|create <x.y.z>|close <x.y.z> [--move-to <x.y.z>]`; no argument means `current`.

## Instructions

1. Run the script for the mode; it prints JSON (`schema/milestones.schema.json`). `current`, `list` and `<name>` are read-only and use only `gh api` GET calls.

   ```powershell
   pwsh scripts/Get-Milestones.ps1 -Mode current            # or: -Mode list | -Mode show -Name <x.y.z> | -Mode create -Name <x.y.z> | -Mode close -Name <x.y.z> [-MoveTo <x.y.z>]
   pwsh scripts/Get-Milestones.ps1 -Mode issues -Name <title> [-State open|closed|all]   # all issues of a milestone in one REST call (deliver)
   ```

   Exit 1 with a message on stderr (not found, invalid name, `gh` failed): report the message and stop.

2. `current` → the open milestone with the lowest semver title above `latestTag`. `current: null` → print `hint` and stop. Otherwise render it as in step 3.
3. `current` and `<name>` (a milestone detail): one header line `<title> (<state>) · due <dueOn or —> · <closed>/<open + closed> closed (<progress> %)`, then one table of the open issues:

   | Group            | Issue     | Note                    |
   | :--------------- | :-------- | :---------------------- |
   | ready            | #12 title |                         |
   | blocked          | #13 title | blocked by #11, o/ci#10 |
   | needs-decision   | #14 title |                         |
   | needs-refinement | #15 title |                         |
   | claimed          | #16 title | @login                  |

   Order the rows ready, blocked, needs-decision, needs-refinement, claimed; a blocker with `repository` is written `<repository>#<number>`, else `#<number>`; omit empty groups, and write `no open issues` instead of an empty table. `releasePr` set → end with `Release PR: #<number> <url>`.

4. `list` → one table `Milestone | State | Open | Closed | Progress | Due | Tag`, in the script's order (semver ascending, other titles last); `Tag` is `v<title>` when `tagged`, else `—`. Below it `Latest release: <latestTag>`.
5. `create <x.y.z>` → `created: true` reports `created milestone <title>`; `created: false` reports `milestone <title> exists (<state>)` and changes nothing.
6. `close <x.y.z> [--move-to <y.y.y>]` (after the tag `v<x.y.z>`; the release routine is tag, `close`, then `create` the next milestone) → `closed: true` reports `closed milestone <title>` and, for `moved[]`, `moved #a, #b to <y.y.y>`. `closed: false` with `state: closed` reports `milestone <title> was already closed`. `closed: false` with `openIssues[]` closed nothing: list them and ask whether to rerun with `--move-to <x.y.z>` (the target must exist and be open; create it first with `create`).

## Gotchas

- Each open issue appears in one group only, in the precedence `needs-decision`, `needs-refinement`, blocked (open blockers), claimed (any assignee), ready. Pull requests are never listed.
- A milestone whose title is not `x.y.z` is listed, but never `current`. Open milestones at or below the latest tag are stale: they show in `list`, not as `current`.
- `create` never renames, edits or closes a milestone, and drops a leading `v` from the name. `close` never renames, edits the due date or deletes a milestone, needs the tag `v<x.y.z>`, and moves only open issues (never pull requests) and only with `--move-to` to an existing open milestone, never created implicitly. Nothing else moves issues.
- The release PR comes from `github-release` (`scripts/Get-ReleaseState.ps1`); without that skill installed `releasePr` is null.

Report: the table(s) of the mode, or the `create` or `close` line.
