# Task issues inside a PBI

A PBI that needs two or more tasks gets `[Task] <conventional title>` sub-issues (label `task`), for example `[Task] chore: add task field to plan schema`. A PBI that fits one session gets no Task issue. Create them from the approved `planner` plan.

Body, first line `Parent PBI: #<pbi>` (a Bug parent: `Parent Bug: #<bug>`):

```markdown
Parent PBI: #<pbi>

## Overview
<goal in one or two sentences>

## Implementation Notes
<how and where; exact files and symbols>

## Invariants
<optional: only for async, persistence or state-machine Tasks, written by `planner`; omit this heading when no invariant applies>

<!-- agent-ready:start -->
## Context
<what the implementer must know that the PBI does not say>

## Depends on
Blocked by #<task>, or none (also set as native blocked-by link)

## Files
- <path>

## Done when
- <observable result, tests included; names the interface(s) under test>
<!-- agent-ready:end -->
```

## Rules

- Native sub-issue link to the PBI and native blocked-by links in plan order (`sub-issues.md`); the body lines only document them.
- The Task issues are the source of truth. A plan change during implementation edits the Task issue body (`gh issue edit`) or adds a new Task issue.
- Commits on the PBI branch carry `Refs #<task>`, never `Closes`: the PBI's PR closes `#<pbi>` and the release closes the open sub-issues.
- Task sub-issues of a PBI never become separate branches or PRs: all Task commits land on the PBI branch. Existing hand-made Task issues are used as they are.

## Commits and resume

- Subject `<type>: <description> (#<pbi>)`, last footer line `Refs #<task>` alone on its line. A PBI with a single task has no Task issue: the footer is `Refs #<pbi>`.
- Task merged: `<task>` is digits only (`^[0-9]+$`). `git fetch origin <integration-branch>`, then `git log -E --grep "^Refs #<task>$" origin/<integration-branch> --format=%h -1` finds a commit on the remote integration branch (Task issues stay open because `Closes` fires only on the default branch; the anchors keep `#12` from matching `#123`) → `gh issue close <task> --comment "Merged into <branch> in <sha>"` and skip it. A squash merge that drops the footers hides merged tasks. Task done on the current branch (resume): same grep on `origin/<integration-branch>..HEAD`.
- Review range `<first BASE>..HEAD`: `BASE` of the first task is `git merge-base HEAD origin/<integration-branch>`. If the range is empty (everything already merged), report "already merged" with the SHAs the grep found and do not review.
- PR task list, one line per task: `#<task> — <sha>`, the last commit carrying that task's `Refs` footer; a single task without issue: `#<pbi> — <sha>`.
- Only sub-issues labelled `task` are tasks of the PBI's branch. Children labelled `pbi` (of a Feature or Epic) are separate PBIs with their own branch.
- Blocking order between hand-made Task issues comes from the native blocked-by links.
