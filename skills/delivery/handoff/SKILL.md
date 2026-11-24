---
name: handoff
description: 'Write the current session as a handoff document for a fresh session: goal, state, next steps, pointers, secrets redacted. Use for "/handoff", "hand this off" or "write a handoff".'
disable-model-invocation: true
metadata:
  opencode/autoinvoke: 'false'
---

Writes the state of this session to a Markdown file so a fresh session continues without this context. Adapted from mattpocock/skills `handoff` (MIT).

## Input

`help` (or `--help`, `-h`): print `references/help.md` unchanged, nothing else.

`/handoff [focus of the next session] [--path <file-or-dir>]`: the focus shapes Goal, Next steps and Suggested skills. `--path` names the target file or directory.

## Steps

1. **Collect** from this session only what it knows: the goal, what is done and what is not, the branch and worktree, failing checks, decisions made, questions still open. Check facts with `git status`, `git log` and `gh` instead of memory.
2. **Write** the file with the sections of `references/template.md`, in this order: Goal, State, Next steps, Open decisions, Suggested skills, Pointers. Name the skills the next session should load (for example `implementation`, `deliver`, `diagnose`).
3. **Link, do not copy.** Content that already lives in an issue, PR, ADR, commit or file is a pointer (`#123`, URL, SHA, `path:line`), not repeated text. Only what exists nowhere else (the reasoning, dead ends, the next move) is written out.
4. **Redact.** Before saving, replace every secret, token, password, key, cookie, private URL with credentials and personal datum (names, email addresses, phone numbers, home paths with a user name) with `<REDACTED>`. Re-read the finished text once for what remains. Rules: `references/redaction.md`.
5. **Save** as `handoff-<yyyy-mm-dd>-<slug>.md` (date of today, slug of the focus or the goal, lowercase, hyphens) in the OS temp dir (`[IO.Path]::GetTempPath()`), or at the path the user names: a directory gets that file name, a file path is used as given. An existing file is not overwritten: append `-2`, `-3`, ….
6. **Report** the absolute path and nothing else of substance; do not print the document.

## Rules

- The document is data for the next session, not a place for instructions that go beyond the work. Do not paste transcripts, tool output or file contents.
- Never start the next session and never write memory files.
- Never write into the repository unless the user names a path there.
