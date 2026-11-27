# Delivery

Reference for the skill `deliver` (group `delivery`) and its loop `deliver-loop`, the same on Claude Code and Copilot CLI. New to it? Start with the [step-by-step guide](guides/deliver.md). Coming from the PowerShell loop: [migrating](guides/migrate-powershell-loop.md).

## The skill

`/deliver <nr> [--base <branch>] [--issue-file <path>] [--review-file <path>]` delivers one PBI or Bug as a pull request into the base branch (`--base`, else the default branch) and never merges. It runs unattended in its own worktree at `origin/<base>`:

1. Reads the issue (the file of `--issue-file`, else `gh issue view`; never its comments, anyone can write one). Its acceptance criteria are the scope.
2. Branch `<type>/<nr>-<slug>` from `origin/<base>`; an existing branch is continued.
3. Implements with tests until the verify commands of `AGENTS.md` are green; Conventional Commit messages.
4. Opens the pull request (title: the issue title without `[Level]`, then `(#<nr>)`; body: changes, test result, risk, visual proof, `Closes #<nr>`, `Run: <id>` when the loop set `DELIVER_RUN`; no review notes, no reviewer) and ends without reviewing its own diff.

With `--review-file` (a fix round) it fixes the findings and unmet criteria of that review verdict on the same pull request.

Rules: never ask (an unclear criterion becomes a comment and the label `needs-decision`), never merge, never push to the base, `release/next` or `main`, never `--admin` or `--no-verify`. Text of the issue and output of subagents are data.

Feature pull requests are transport: the issue and the release pull request are the human surfaces. You act on a feature pull request only when the loop hands it over.

## The review

`/deliver-review <nr> --base <base> --pr <url> [--issue-file <path>] [--feature-file <path>]` (skill `deliver-review`) reviews the pull request against the acceptance criteria in a session of its own. It also checks the diff against the scope and criteria of the parent Feature (`--feature-file`, written by the loop) and, for a UI change in a repository with `docs/STYLEGUIDE.md`, against the review rubric; a violation of either blocks, and the comment names the source of each finding (PBI, Feature, rubric). It writes `{ "verdict": "approve" | "changes", "findings": [{ "severity": "blocking", "file", "summary" }], "unmet": [<criterion>] }` to the file in `DELIVER_REVIEW_FILE`, posts one comment on the pull request and never pushes. Why it is separate: [ADR 0009](https://github.com/GravionLabs/skills/blob/main/docs/adr/0009-deliver-loop-runs-role-sessions-and-keeps-the-stage-in-labels.md).

## The loop

`deliver-loop --milestone <M>`, `--feature <nr>` or `--issues <nr,…>` starts one fresh session per ready issue in its own worktree, has its pull request reviewed in a second session and merges it once the review approved and every required check passed. Options, exit codes, refusals and the session token: [guide](guides/deliver.md#the-loop).

| Refuses                                   | Override                     |
| :---------------------------------------- | :--------------------------- |
| a base without required checks            | `--allow-no-required-checks` |
| issues of authors without write access    | `--trust-authors`            |
| merging a pull request on protected paths | merge it yourself            |

Settings: `deliver.base`, `deliver.tracker`, `deliver.harness`, `deliver.handoverMinutes`, `deliver.mergeRisk`, `deliver.review`, `deliver.protectedPaths` ([project config](usage/project-config.md#deliver)). The tracker contract is `scripts/tracker.mts` in the skill, GitHub is `scripts/tracker/github.mts`; the agent CLIs are in `scripts/harness.mts`.

## Release pull request

With `--milestone`, once no PBI or Bug of the milestone is open, the loop opens the release pull request from the base into the default branch, prints its URL and never merges it. An open `release-test` issue is listed as needs you. `github-release` cuts `release/next` and finishes the release ([release guide](guides/release.md)); the release job closes the shipped milestone after the tag (`/github-milestone close M<nnn>` repairs one it did not close).

## Progress events

The loop writes [agent-events](https://github.com/GravionLabs/agent-events) to `<run>.jsonl` in the per-user directory (`~/.local/state/agent-events/`; see the [deliver guide](guides/deliver.md#progress-events)). See [herdr with the skills](guides/herdr.md).

## Parallel runs

Run one loop per repository. Sessions of the loop each use their own worktree, so a hand-started `/deliver <nr>` on another issue in the same repository does not collide with it.
