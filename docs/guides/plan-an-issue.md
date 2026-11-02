# Plan an issue with planner and grill-me

`planner` plans an issue one level down, `grill-me` asks you the open decisions, and after you approve, `github-issue` creates the issues. Planning edits no source files.

## What "one level down" means

| You plan   | Plan items                                                                                                  |
| :--------- | :---------------------------------------------------------------------------------------------------------- |
| Epic       | Features                                                                                                    |
| Feature    | PBIs (`feat: …`, `fix: …`)                                                                                  |
| PBI or Bug | nothing when it fits one session (use `refine <nr>`); too big (size L): sibling PBIs under the same Feature |

There is no Task level. A Feature is broken down PBI by PBI, and `[Task]` issues of older plans are only read, never created. One item is one fresh session.

## Sizes and blockers

Every item has a size (S, M or L) and `blocked_by`, a list of other plan ids or existing issue numbers. The blockers form a graph without cycles; `github-issue` turns them into native blocked-by links. An L item is split into sibling PBIs. `/deliver` works the items in blocker order.

## Example: `Plan issue #42.`

```text
Plan issue #42.
```

`planner` reads the issue and all its children, explores the code and returns a plan like this (shortened):

| id  | title                        | size | blocked_by |
| :-- | :--------------------------- | :--- | :--------- |
| p1  | feat: export schema          | S    |            |
| p2  | feat: export command         | M    | p1         |
| p3  | feat: export progress output | S    | p2         |

Open product, scope and risk choices are not guessed. They come back as questions, and facts the repository can answer are never asked.

## The grilling rounds

`grill-me` asks all independent questions of a round at once, each with its options, the recommended option first and a short reason:

```text
q1  Which export format does the command write?
    1. JSON (recommended)  2. CSV  3. Both
    Why: JSON keeps nested data; CSV is a later PBI if needed.
```

Your answers can remove questions or add new ones, which start the next round. The rounds end when nothing is open. A question that blocks something may be deferred: the affected issue then gets the label `needs-decision` and an "Owner decision required" block.

## Approval and creation

`planner` shows the items (id, title, size, `blocked_by`) and your answers. You approve granularity, blockers and which items to create, also when there were no questions. Nothing is created before. Then `github-issue` creates the issues with native sub-issue and blocked-by links. Each issue gets the answers that concern it under `## Decisions`, one line each: `<question> — <answer>`.

## Sharpen an existing issue: `refine 42`

```text
refine 42
```

`planner` checks the issue against the readiness list of its level and collects only the gaps. `grill-me` asks them, then the issue body is updated: the answers go under `## Decisions` and the criteria are sharpened.

```markdown
## Decisions

- Which export format does the command write? — JSON
- Is an existing file overwritten? — No, fail with a clear error
```

Labels ([issue model](../concepts/issue-model.md#labels)) follow the result: a ready issue loses `needs-refinement`; with an open decision it gets `needs-decision` and the question as a comment. A size L PBI gets a proposed split into sibling PBIs, created only after approval. `/deliver` skips issues labelled `needs-refinement`.

## Decision PBIs with governance

When `.agents/config.json` has `governance` ([ADRs and specs](../usage/governance.md)), an item that touches `adrPaths`, adds a service or an external dependency, or reverses an accepted ADR gets its own decision PBI (`docs: ADR <topic>`, label `needs-decision`). The implementing item lists it in `blocked_by`. The ADR is written as Proposed; the owner accepts it.

## Next

Deliver the planned PBIs with `/deliver 42` ([delivery](../delivery.md)) and see [work an issue by hand](work-an-issue-by-hand.md) for the session routine.
