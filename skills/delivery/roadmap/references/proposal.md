# Proposal and milestone assignment

Used by `/roadmap` steps Propose, Decide and Set. State comes from `scripts/Get-RoadmapState.ps1`.

## Propose

Only Features are planned (`github-issue` `references/milestones.md`, ADR 0010): an Epic, a PBI or a Bug is never assigned.

1. Take `issues[]` and `milestones[]`. Candidates are the Features without a milestone; a Feature already in an open milestone keeps it unless the user asks to move it.
2. Put every open PBI and Bug under its Feature (`parent`, up the chain). Its size and blockers count towards that Feature; a blocker below another Feature blocks as that Feature, one below the same Feature is ignored.
3. Order by the blocked-by DAG of the Features (`blockedBy`): a blocker lands in the same or an earlier milestone than the Features it blocks. A cycle is an open decision. A blocker in another repository (`owner/repo#n` string) does not take part in the DAG: it never matches a local issue; show it as an external blocker in the Blockers column.
4. Migration: a Feature without a milestone whose open PBIs still sit in open milestones is proposed for that milestone, with several for the latest of them.
5. Fill by size within each milestone (S small, M medium, L large, summed over the open PBIs and Bugs of each Feature; a Feature without them counts its own size; weights, not hours). Ask the user for the capacity per release when it is unknown.
6. Use existing open `M<nnn>` first in ascending order; propose a new `M<nnn>` (next free number) only when they are full or the DAG needs a later one.
7. Print one table of the Features, ordered by milestone and DAG:

| Feature | Title | Open PBIs and Bugs | Size | Blockers | Proposed M<nnn> |
| :------ | :---- | :----------------- | :--- | :------- | :-------------- |

Mark new milestones as `M004 (new)`. Below the table list every PBI and Bug without a Feature as `unplanned, ships at merge`.

## Decide

Collect before the table is final and hand them to `grill-me` as `questions[]`: scope per release, Features without size (own or of their PBIs and Bugs), Features with `needs-decision` (own or below them), dependency cycles. Unresolved Features stay out of the assignment. Nothing is set before the user approves the final table.

## Set

After approval run, from the project root:

```powershell
pwsh <skill-dir>/scripts/Set-IssueMilestones.ps1 -Assignment '[{ "issue": 12, "milestone": "M003" }, { "issue": 13, "milestone": "M004" }]'
```

`-Assignment` is a JSON array of `{ "issue": <int>, "milestone": "<name>" }` or the path of a file holding it. `milestone` is `M<nnn>`, `M<nnn> <Topic>` or legacy `x.y.z` (resolved as in `github-milestone`: `M003` finds `M003 Market data`); Features only; an issue appears once.

- All checks run before the first write. A closed milestone, an unknown issue or invalid input exits 1 and changes nothing.
- A missing `M<nnn>` is created with `Get-Milestones.ps1 -Mode create` of `github-milestone`.
- An issue already in the target milestone is skipped, so a re-run is safe.
- Output follows `schema/set-issue-milestones.schema.json`: `created[]` and `results[]` (`issue`, `milestone`, `status` `set` or `unchanged`).

- An Epic, or a PBI or Bug (its milestone is set at merge; a `release-test` is allowed), exits 1 and changes nothing.
- A Feature is set whatever the milestones of its PBIs.

`planner` asks for a milestone only for the Features it creates; this step assigns the rest.
