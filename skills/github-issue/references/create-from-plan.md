# Create issues from a plan

Input: the `plan.json` of `planner` (its `references/plan-schema.md`). The plan has no issue
numbers of its own; this procedure creates the issues, links them to the parent and sets the
blocked-by links. Link calls and their gotchas: `sub-issues.md`.

## 1. Before anything is created

- `status` is `ok`; on `fail` show `summary` and stop.
- Show every entry of `questions[]` (question, options, recommended, why, blocked items) to the
  user and wait for the answers. Fold the answers into the affected item bodies; create nothing
  before that.
- Show the items (id, title, size, `blocked_by`) for approval.

## 2. Create each item, in plan order

| `level` | Title | Label |
| :-- | :-- | :-- |
| `feature` | `[Feature] <title>` | `feature` |
| `pbi` | `[PBI] <title>` | `pbi` |
| `task` | `[Task] <title>` | `task` |

The body is used as given; its first line is already `Parent …: #N`.

```powershell
$url = $item.body | gh issue create --label <level> --title "[<Level>] <title>" --body-file -
$nr  = [int]($url -split '/')[-1]   # remember: $created[<plan id>] = $nr
```

## 3. Link to the parent

`addSubIssue` of every created issue to `parent_issue` (`sub-issues.md`, "Link a child to a
parent"). A plan from a description (`parent_issue` is `null`) has no parent link.

## 4. Blocked-by links

For every item and every entry of its `blocked_by`: a plan id (string) resolves to
`$created[<id>]`, an integer is an existing issue number and stays. Then add the link per
`sub-issues.md`, "Blocked-by links" (database id of the blocker, `-F issue_id=`).

## 5. Verify

Per `sub-issues.md`, "Verify": the parent's `sub_issues` count equals the item count, each body's
first line names the parent, and each issue's `dependencies/blocked_by` numbers equal its resolved
`blocked_by`. Fix gaps instead of reporting success; report the created numbers by plan id.
