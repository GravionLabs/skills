# Troubleshooting

Common failure cases of the skills, each with symptom, cause and fix. The state of a `/deliver` run lives in GitHub, so after a fix `/deliver <nr>` picks up where it stopped ([resume](../guides/deliver.md#resume-after-a-stop)).

## deliver pauses with needs-decision

- **Symptom:** the PBI gets the label `needs-decision` and a comment with a question. Interactive, the chat asks instead.
- **Cause:** `deliver` never guesses. An unclear acceptance criterion, an error, a blocker, or extra work the PBI body does not name pauses the run. A decision PBI (ADR criterion) is reported `decision, write the ADR with adr`.
- **Fix:** answer in the comment (`grill-me` interviews you for it), remove the label `needs-decision`, run `/deliver <nr>` again. For a decision PBI write the ADR with the `adr` skill first.

## deliver warns that release/next has no ruleset

- **Symptom:** at the start, a warning that red CI is mergeable.
- **Cause:** `gh api repos/{owner}/{repo}/rules/branches/release/next` lists no `required_status_checks`. `deliver` merges when review and required checks are green, so without the rule the gate is missing.
- **Fix:** create the ruleset ([ruleset on release/next](../guides/release.md#ruleset-on-release-next)) and run again. The run goes on without it, but nothing then blocks a red check.

## A PBI is skipped

- **Symptom:** the report has `select: needs refinement, skipped`, `select: claimed, skipped` or `select: interactive, skipped`.
- **Cause:** `needs-refinement` marks a PBI or Bug that is not ready (no criteria, no repro). A claim is an assignee: another session works on it, and the claim is fresh when the branch or PR was updated within the hour. `interactive` PBIs are skipped unattended.
- **Fix:** `needs-refinement`: run `planner refine <nr>`. Claimed: wait; after an hour without activity the claim counts as stale and `deliver` takes it over. A PBI you name yourself (`/deliver <nr>`) continues whatever the claim says. `interactive`: run `/deliver <nr>` in a session.

## gh is not authenticated

- **Symptom:** `deliver`, `planner` or `github-issue` stop at the first `gh` call with an authentication error.
- **Cause:** no `gh` login in this shell, an expired token, or a token without the `repo` scope.
- **Fix:** `gh auth login` (or `gh auth refresh -s repo`), check with `gh auth status`, run again. Tool check: `check-prerequisites` ([prerequisites](../prerequisites.md)).

## A skill does not trigger

- **Symptom:** the agent works without loading the skill you expected.
- **Cause:** the skill is not installed in this project (or client), or the prompt does not match its `description`.
- **Fix:** check the install (`npx skills check`, or `/skill-manage dry-run`); name the skill in the prompt (`Use the planner skill: plan issue #42`) or call it by slash (`/deliver 42`). To measure triggering, see [skill trigger evals](../usage/trigger-evals.md).

## The context grows too large

- **Symptom:** a long run slows down, the context fills, quality drops.
- **Cause:** one session over a whole release collects every PBI.
- **Fix:** limit the run with `--max <n>`, or use a fresh process per PBI: `Invoke-DeliverLoop.ps1` ([deliver in fresh sessions](../guides/deliver.md#a-release-in-fresh-sessions)). A [status line](../usage/statusline.md) shows the fill level.

## A red check blocks the merge

- **Symptom:** the PBI is reported blocked, the PR stays open, or the merge is refused.
- **Cause:** a required check is red or pending. `deliver` never merges on red and never uses `--admin`. A red caused by the diff gets fix rounds (at most 2 per PBI, shared with the review); a red for another reason (flake, `release/next` red too) blocks the PBI with a PR comment.
- **Fix:** read the failed check (`gh pr checks <pr>`), fix the cause (or re-run a flaky job), then `/deliver <nr>` again. Fix a red `release/next` first.
