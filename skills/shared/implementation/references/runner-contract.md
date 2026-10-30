# Runner contract

How `implementation` behaves as the implementer role when a runner (such as `deliver`) or a caller starts it for one Task. Interactive use is unchanged; this file only adds the input, the rules and the result.

## Input

- the Task issue body (scope, Implementation Notes, Invariants)
- the acceptance criteria of the parent PBI
- the worktree: the working directory, already on the task branch

Read the files the Task names, then follow `SKILL.md` and the `<lang>-implementation` skill from `detect-techstack`.

## Rules

- Commit the change with `Refs #<task>` in the message (`<type>: <description> (Refs #<task>)`); files added by name.
- Never call `gh`: no issue, comment, label or pull request calls. The caller owns GitHub.
- Never push. The caller pushes.
- Stay inside the worktree and the files of the Task; a criterion that cannot be met as written ends in `blocked`, not in a reinterpretation.
- Tests and format per `SKILL.md` before the commit.

## Result

Print one JSON object that validates against `schema/implementer.schema.json`, nothing else.

| Property | Meaning |
|---|---|
| `status` | `done` (committed, tests green) or `blocked` (nothing committed that is red) |
| `commit` | SHA of the commit; `null` when `blocked` without a commit |
| `filesChanged` | paths changed by the commit, relative to the worktree |
| `testsRun` | the test commands run and their outcome, one string |
| `notes` | decisions, deviations, follow-ups; for `blocked` the reason and what is needed |

```json
{
  "status": "done",
  "commit": "a1b2c3d",
  "filesChanged": ["src/parse.ts", "src/parse.test.ts"],
  "testsRun": "pnpm vitest run src/parse.test.ts: 6 passed",
  "notes": []
}
```
