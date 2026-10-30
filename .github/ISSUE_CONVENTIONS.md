# Issue Conventions

This document defines how issues are structured, titled, labeled, and linked in this repository.

## Hierarchy

```
Epic
└── Feature
    └── PBI (Product Backlog Item)

Bug
```

- An **Epic** groups related Features toward one larger outcome.
- A **Feature** groups the PBIs that deliver one user-facing capability.
- A **PBI** is a shippable increment: one PR-sized (or few-PR-sized) unit of value.
- There is no Task level: a PBI or Bug too big for one session is split into sibling PBIs. `[Task]` issues of older plans are read and closed with their PBI, never created.
- A **Bug** lives outside the epic hierarchy but may reference an Epic/Feature in its Background.

## Titles & labels

| Type    | Label     | Title convention                                                    |
| ------- | --------- | ------------------------------------------------------------------- |
| Epic    | `epic`    | `Epic: <name>`                                                      |
| Feature | `feature` | `Feature: <name>`                                                   |
| PBI     | `pbi`     | Conventional commit: `feat: …`, `refactor: …`, `docs: …`, `test: …` |
| Bug     | `bug`     | `fix: <symptom>`                                                    |

Additional area labels (`library`, `demo`, `form`, `navigation`, `design-system`, …) may be added on top of the type label.

## Linking rules

Every issue that has sub-issues must link them **both** ways:

1. **Native sub-issue relationship** — add each child as a GitHub sub-issue of the parent:

   ```bash
   # child_id is the issue's numeric database ID, not its number:
   child_id=$(gh api repos/{owner}/{repo}/issues/<child-number> --jq .id)
   gh api repos/{owner}/{repo}/issues/<parent-number>/sub_issues \
     -X POST -F sub_issue_id="$child_id"
   ```

2. **`Sub-Issues` checklist** in the parent body, one line per child:

   ```markdown
   ## Sub-Issues

   - [ ] #346 — fix: forward BullMQ lifecycle events to SSE
   - [ ] #347 — feat: queue depth on /healthz
   ```

Each child references its parent with a `Part of #NNN` line in its **Parent** section. Closing PRs reference the PBI/Bug they resolve with `Closes #NNN`.

## Fields per issue type

### Epic

| Section            | Content                                           |
| ------------------ | ------------------------------------------------- |
| Overview           | What this epic groups and why (2–4 sentences)     |
| Background         | Current state / pain points motivating the epic   |
| Goals              | Bullet list of outcomes                           |
| Out of Scope       | Explicit non-goals                                |
| Sub-Issues         | Checklist of Features                             |
| Definition of Done | Measurable completion criteria for the whole epic |

### Feature

| Section            | Content                                     |
| ------------------ | ------------------------------------------- |
| Overview           | What the feature delivers                   |
| Background         | Why it's needed, links to design/discussion |
| Parent             | `Part of #NNN` (epic)                       |
| Scope              | In scope / out of scope bullets             |
| Sub-Issues         | Checklist of PBIs                           |
| Definition of Done | Feature-level acceptance criteria           |

### PBI

| Section             | Content                                                  |
| ------------------- | -------------------------------------------------------- |
| Overview            | User story or concise description of the increment       |
| Background          | Context, constraints, prior art                          |
| Parent              | `Part of #NNN` (feature)                                 |
| Acceptance Criteria | Testable Given/When/Then or bullet criteria              |
| Technical Notes     | Implementation hints, affected files/packages (optional) |
| Definition of Done  | Code + tests + docs criteria                             |

### Bug

| Section            | Content                        |
| ------------------ | ------------------------------ |
| Description        | What is broken                 |
| Reproduction       | Numbered steps                 |
| Expected Behavior  | What should happen             |
| Actual Behavior    | What happens instead           |
| Environment        | Versions, browser, OS          |
| Screenshots        | Optional                       |
| Definition of Done | Fix + regression test criteria |

## Creating issues with `gh`

```bash
# Epic
gh issue create --label epic --title "Epic: <name>" --body-file epic.md

# Feature under epic #10
gh issue create --label feature --title "Feature: <name>" --body-file feature.md
child_id=$(gh api repos/{owner}/{repo}/issues/<feature-number> --jq .id)
gh api repos/{owner}/{repo}/issues/10/sub_issues -X POST -F sub_issue_id="$child_id"
# …then add "- [ ] #<feature-number> — <title>" to epic #10's Sub-Issues section.
```
