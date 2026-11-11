# Issue model

The skills work on one issue hierarchy with a fixed set of labels. `github-issue` owns the conventions; `planner`, `deliver` and `github-milestone` read them. This page is the one place that explains them; the guides link here.

## Levels and titles

| Label       | Title (always `[<Level>] <summary>`)        | Children                                            |
| :---------- | :------------------------------------------ | :-------------------------------------------------- |
| `objective` | `[Objective] <outcome>`                     | Features or Epics, also of other repos of the owner |
| `epic`      | `[Epic] <outcome>`                          | Features                                            |
| `feature`   | `[Feature] <capability>`                    | PBIs                                                |
| `pbi`       | `[PBI] feat(scope): …`, `[PBI] refactor: …` | none                                                |
| `bug`       | `[Bug] fix: <symptom>`                      | none                                                |

- A PBI is the unit of delivery: one pull request. There is no Task level; a PBI that is too large (size L) is split into sibling PBIs. Open `[Task]` issues of older plans are only read and closed with their PBI.
- The shared `issues.yml` workflow of `GravionLabs/ci` sets the title prefix from the level label.

## Links between issues

- **Parent and child** are native GitHub sub-issues, not Markdown checklists. Closing a child updates the parent's progress.
- **Order** is expressed by native blocked-by links. `deliver` delivers the open PBIs of its targets in that order, each once.

## Labels

| Label              | Meaning                                                           | Effect                                                                                    |
| :----------------- | :---------------------------------------------------------------- | :---------------------------------------------------------------------------------------- |
| `needs-refinement` | The issue is not ready: criteria, size or blockers are missing.   | `deliver` skips it. `planner refine <nr>` checks it and removes the label when ready.     |
| `needs-decision`   | A question is open (a comment holds it) or the PBI is a decision. | `deliver` pauses or skips it. Answer in the issue, remove the label, run `deliver` again. |
| `interactive`      | The work needs a person in the loop, or a larger model.           | Skipped by `deliver --unattended`; delivered in an interactive session.                   |

A PBI that another session claimed (assignee) is skipped too, see [delivery](../delivery.md).

## Milestones

A milestone holds the work items that are delivered: PBIs and Bugs always have one. A Feature has one only when all its PBIs are in that milestone, an Epic and an Objective never. `github-milestone` shows breaks of the rule as `warnings`, `roadmap` refuses them, and `deliver --milestone` skips work items outside the milestone. Closing is independent: after the release PR is merged, Features whose sub-issues are all closed close with them. Details: `references/milestones.md` of `github-issue`.

## Branches and the release branch

- Work branches are named `<type>/<nr>-<slug>`, for example `feat/42-csv-export`. The slug comes from the title without its `[Level]` prefix and conventional type.
- Branches are cut from and merged into `release/next`, the rolling integration branch, never `main`. `github-release` cuts it and finishes it with the release PR into `main`, the human gate. Milestones are the releases.
- Commit and PR titles end with `(#<nr>)`; the PR body has `Closes #<nr>`.

## Related

- [Skill composition](composition.md)
- [Plan an issue](../guides/plan-an-issue.md), [deliver issues](../guides/deliver.md), [release a milestone](../guides/release.md)
- `skills/github/github-issue/SKILL.md` and its `references/` hold the full rules.
