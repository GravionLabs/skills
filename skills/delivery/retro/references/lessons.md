# Lesson drafts

Load this for step 6 of `retro`. The file format, the scopes and the lifecycle are owned by the `lessons` skill (`references/contract.md`); this file only says how `retro` turns a candidate into a draft and how a draft reaches the repository.

## Lesson or PBI

| Candidate                                                                          | Draft                           |
| :--------------------------------------------------------------------------------- | :------------------------------ |
| holds for every project (a skill rule, a check, a review rule, an agent or model)  | PBI (step 5)                    |
| holds only for this repository, one language (`lang:<x>`) or one role (`role:<r>`) | lesson                          |
| both: a general rule is missing and this repository needs the note until it ships  | PBI and lesson                  |
| a mechanical mistake (format, lint, missing file)                                  | PBI for a check, never a lesson |

A lesson is a plain statement about the repository, at most 600 characters, no commands to run. A candidate that would need a command, a permission or a skipped check is a PBI, not a lesson: the guard of `Get-Lessons.ps1` flags such text.

## Draft

One file per lesson, named `<nnn>-<id>.md`; `<nnn>` continues the numbering of the existing `.agents/lessons/` (`010`, `020`, … when the folder is empty or missing).

```markdown
---
id: <kebab-case id, unique in .agents/lessons/>
scope: [repo]
evidence: <the candidate's evidence, e.g. PR #12; retro #197>
status: proposed
version: 1
created: <today, YYYY-MM-DD>
---

<lesson text>
```

- `scope`: `repo`, `lang:<x>` or `role:<r>` per the contract; pick the narrowest scope the evidence supports (a review finding → `role:review`, a finding in one language's files → `lang:<x>`).
- `evidence`: the evidence of the candidate (turn, review finding, metric) as PR, issue, commit or retro reference; never a transcript quote or a secret.
- `status` is always `proposed`; `retro` never writes `approved`.

## Check before showing

`Get-Lessons.ps1 -Check` reads `.agents/lessons/` of the git toplevel, else of the working directory. To check drafts without touching the repository, write them to a new temporary folder outside any git repository and run the check from there (`<lessons-dir>` is the installed `lessons` skill, e.g. `.claude/skills/lessons/`, `~/.claude/skills/lessons/` or `.agents/skills/lessons/`):

```powershell
$tmp = Join-Path ([IO.Path]::GetTempPath()) "retro-lessons-$PID"
New-Item -ItemType Directory -Path (Join-Path $tmp '.agents/lessons') -Force | Out-Null
# write each draft to $tmp/.agents/lessons/<nnn>-<id>.md, plus copies of the existing lessons to check id uniqueness
Push-Location $tmp; pwsh <lessons-dir>/scripts/Get-Lessons.ps1 -Check; Pop-Location
Remove-Item -Recurse -Force $tmp
```

Every `<file>: <reason>` line is fixed in the draft before it is shown; exit 0 means the drafts are valid. `lessons` not installed: say so, check the frontmatter by hand against the contract and mark the drafts as unchecked. Then show each draft as text (file name and content) and ask which to keep.

## After approval

Only the drafts the user approved, and only after that approval:

1. Branch from the release branch (`github-issue` `references/release-branches.md`), e.g. `docs/<issue>-lessons`.
2. Write the drafts into `.agents/lessons/` with `status: proposed`, run `Get-Lessons.ps1 -Check` in the repository (exit 0), commit `docs(lessons): <summary>` (`Refs #<issue>` when there is one).
3. Open a normal pull request with `github-pull-request`, one line per lesson with its evidence in the body.

The lesson is approved in that pull request: a reviewer sets `status: approved` (a commit in the PR) before the merge. A lesson merged as `proposed` is not loaded. `retro` never sets `approved` itself and never merges the PR.
