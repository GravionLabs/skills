# Repair an existing PR (step 2)

A PR made by hand ("Compare & pull request") targets `main`, is titled like the branch and has an empty body. `scripts/Repair-PullRequest.ps1 -Pr <n> -Issue <nr> [-Base release/<x.y>]` reads the PR and the issue (REST GET) and fixes it with one `gh pr edit` call, so the allowlist entry `pwsh .claude/skills/deliver/scripts/:*` is enough; no `gh api -X PATCH` in the prompt.

| Field | Rule                                                                                                                                                                                         |
| :---- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| base  | the integration branch (`-Base`, default `release/next`; `github-issue` `references/release-branches.md`). A PR already on `release/*` stays. A `fix/…` head on `main` is a hotfix and stays |
| title | Conventional Commit ending in `(#<nr>)`; if it is not one: `<type of the branch>: <issue title without [Level]> (#<nr>)`                                                                     |
| body  | contains `Closes #<nr>`; an existing body is kept, the line is appended                                                                                                                      |

Output: JSON `{ pr, issue, changed[], foreign, error, command }`; `changed` is empty and no write call happens when the PR is correct.

| Exit | Meaning                                                                 | Run                                                                                                                                                                                   |
| :--- | :---------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 0    | repaired or nothing to do                                               | step 7                                                                                                                                                                                |
| 3    | head repository differs from the base repository (fork): never modified | pause (interactive: ask; unattended: comment, `needs-decision`)                                                                                                                       |
| 1    | repair failed (`error`, `command`)                                      | `gh issue edit <nr> --add-label needs-decision` and `gh issue comment <nr>` with the reason and the exact `command` (`gh pr edit <n> --base … --title … --body …`), then the next PBI |

After a repair, a PR that conflicts with `release/next` (`mergeable` false or `mergeable_state` `dirty`) is rebased by a fix subagent (SKILL.md step 2, one of the 2 fix rounds, `git push --force-with-lease`), then step 4.

Auto-merge (step 8) is only enabled after a successful repair (exit 0); a retarget drops nothing else, step 8 sets `--auto` as usual.
