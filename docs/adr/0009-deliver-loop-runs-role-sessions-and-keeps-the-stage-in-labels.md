# ADR 0009: Role sessions and label state in deliver-loop

- Status: Proposed
- Date: 2026-11-26
- Issues: #1012, #1013, #1014

## Context

One `/deliver` session implemented an issue, reviewed it with a subagent (at most 2 fix rounds) and opened the pull request. The reviewer shared the session's model, harness and time budget, Copilot CLI had no separate reviewer at all, and the loop could not see whether a review had happened: the verdict stayed inside the session. The stage of an issue lives only in the running loop, so a killed run leaves no trace on the issue.

## Decision

**Role sessions.** The loop starts one harness session per role.

- The implementer (`/deliver`) implements, verifies, pushes and opens the pull request. It does not review itself.
- The reviewer (`/deliver-review`) runs in a fresh worktree at the head of the pull request, with its own model, harness and effort (`deliver.review.*`; default: the implementer's harness with another model). It reads the issue file and the diff, writes a verdict file and comments on the pull request. It never pushes.
- Roles talk through files the loop owns: the verdict file is validated by the loop and handed to the implementer as `--review-file`. The count of fix rounds (at most 2) lives in the run.
- The loop merges only the commit that was approved, in addition to the guard and the required checks.

**Label state.** The loop keeps the stage of each issue in one mutually exclusive `agent:*` label (`agent:implementing`, `agent:review`, `agent:changes`, `agent:approved`, `agent:handover`). Only the loop writes them. A new run resumes at the stage of the label. A label is a hint, never an authorization: an approval counts only with the review verdict for the head commit. Implemented by #1014.

## Consequences

- Every issue costs at least two sessions, and the review can run on another model than the implementation.
- A review that gives no valid verdict is retried once, then the issue is set aside; nothing is merged without an approval.
- A push after the approval hands the pull request over to a person.
- `/deliver` started by hand opens a pull request that nobody has reviewed; `/deliver-review` is started separately.
- Installations need the skill `deliver-review` beside `deliver`.

## Alternatives

- Keep the subagent: no separate model or harness, and the loop cannot check that the review happened.
- Keep the state only in the run folder: bound to one machine and invisible on the issue.
