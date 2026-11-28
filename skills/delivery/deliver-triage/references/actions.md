# Result of deliver-triage

The result file holds one JSON object: one `action` and exactly the fields of that action. `parseTriage()` of the `deliver` skill validates it. A missing or additional field, another type, an empty text or list, an unknown action, a second object or invalid JSON is rejected: the result then counts as `needs-owner`.

| `action`      | Fields                                                                                                         |
| :------------ | :------------------------------------------------------------------------------------------------------------- |
| `answer`      | `answer`: the answer to the question. `evidence`: list of texts, each a file and line, commit, URL or log line |
| `drop`        | `reason`: why the issue leaves the current run                                                                 |
| `draft-issue` | `title`: one line, `[PBI]` or `[Bug]` first. `body`: the issue text (`github-issue` format)                    |
| `rerun-ci`    | `job`: the numeric id of the failed job (`gh run view <run> --json jobs`). `reason`: why a re-run can help     |
| `needs-owner` | `reason`: what is to decide and why it is the owner's. `options`: list of texts, the recommended one first     |

All texts are strings that are not blank.

## Examples

```json
{
  "action": "answer",
  "answer": "Yes, the loop already reads the setting.",
  "evidence": ["skills/delivery/deliver/scripts/review.mts:1"]
}
```

```json
{ "action": "drop", "reason": "Needs a release of another repository first." }
```

```json
{
  "action": "draft-issue",
  "title": "[Bug] fix: timeout in the publish job",
  "body": "## Overview\n…"
}
```

```json
{ "action": "rerun-ci", "job": 123456789, "reason": "The runner lost its network connection." }
```

```json
{
  "action": "needs-owner",
  "reason": "The pull request changes a protected path.",
  "options": ["Review and merge it", "Close it and split the change"]
}
```
