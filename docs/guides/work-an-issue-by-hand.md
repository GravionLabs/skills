# Work an issue by hand

The cost of an agent session is its context size, not the skills it loads. In a 30-day sample (AgentLens, 79 sessions) issue sessions averaged 365k tokens per request and skill text made up about 1 % of it; PR and release skills ran at 500k because they were started at the end of long sessions. This page is the operating procedure that keeps contexts small. The skills in this hub assume it.

Everything here is interactive: you start a Claude Code, Copilot CLI or OpenCode session and name the skill or describe the task. To deliver planned issues PBI by PBI, interactive or unattended, use `/deliver 42` (see [delivery](../delivery.md) and [Deliver issues](deliver.md)).

## Install once

```text
/skill-manage core -g    # once per machine: shared, github, delivery, statusline
/skill-manage            # per project: detects the stack
```

`/skill-manage help` prints the usage (groups, `dry-run`, `-g`, presets).

## One issue per session

1. Start a fresh session in the repository.
2. Plan if the issue is large ([guide](plan-an-issue.md)): `Plan issue #42.` (`planner` writes the plan one level down, `grill-me` asks you the open decisions round by round, and after you approve the plan `github-issue` creates the sub-issues with the answers under `## Decisions`; a Feature is broken down PBI by PBI, one grilling and approval each). To sharpen an existing issue: `refine 42` (`planner` grills its open points and updates the body).
3. Implement: `Implement issue #42.` `github-issue` reads the labels (`epic`, `feature`, `pbi`, `bug`), checks for sub-issues, follows the matching reference workflow and creates the branch per the conventional-commit type. `implementation` loads the stack skill and ships tests with every change. Bugs go through `diagnose`, see [Fix a bug](fix-a-bug.md).
4. Verify with the build and test commands of the project.
5. Review once: `Review the current diff.` (`code-review`, the reviewer role). Fix blocking findings; the pull request is the second review.
6. Open the PR: `Create a PR for this branch.` (`github-pull-request` generates a conventional title and a structured body from the commits and the linked issue, then creates it with `gh`).
7. `/clear` (or close the session) before the next issue.

Title and labels follow the hierarchy `[Epic]`, `[Feature]`, `[PBI]`, `[Bug]`; see `github-issue`. `[Task]` issues of older plans are read, never created.

## Model choice

Sonnet is enough for every PBI without the label `interactive`. Use a larger model for planning large Epics and for work labelled `interactive`.

## Keep the context small

- Watch the context yourself (`/context`, or the [status line](../usage/statusline.md)). At about 150k tokens finish the step, leave a short hand-off note in the issue (what is done, what is next) and `/clear`.
- Start PR and release skills in a fresh session, never at the end of a long one.
- Load skills by name when the task is clear; descriptions alone already trigger them.
- Let the agent read files itself instead of pasting diffs or logs into the prompt.
- Do not run two issues in one session.

## Guardrails

The skills ship no git guardrail hook. Guard destructive git commands (force push to `main`/`release/*`, `reset --hard`, `clean -f`, `branch -D`, `checkout -- .` on a dirty tree) with the deny rules of your harness; `/deliver` lists its allowlist per harness in `references/permissions.md`, and the ruleset on `release/next` blocks a red merge whatever the session does.

## Releases and changelog

`github-release cut` creates the rolling `release/next` branch, PBI pull requests target it, and `github-release finish` opens the release PR into `main` with the changelog.

The walkthrough with prompts, the changelog setup and the ruleset on `release/next` are in the [release guide](release.md).
