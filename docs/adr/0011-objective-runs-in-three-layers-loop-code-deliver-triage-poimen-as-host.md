# ADR 0011: Objective runs in three layers: loop code, deliver-triage, poimen as host

- Status: Proposed
- Date: 2026-11-27
- Issues: #1081, #1041, #1114
- Builds on: [ADR 0009](0009-deliver-loop-runs-role-sessions-and-keeps-the-stage-in-labels.md)

## Context

An Objective run delivers the work of several repositories: it keeps the order between them, waits for releases, reacts to what goes wrong and asks the owner where only the owner can answer (#1041).

In the orchestrated run of GravionLabs/helix#1204 (2026-11-26/27) one agent session stayed open and did all of this. It did the judgment well: the fact check that answered skills#1043, moving skills#1038 out of the milestone, filing the follow-up issues, the rubric audit and 11 observations. It missed mechanical checks: the failed publish job of helix v22.10.1, pull requests of risk `high` that were merged, and a milestone that grew during the run.

A session that stays open all night spends tokens while it waits, loses its state when it dies, and its checks are only as reliable as its attention. It also binds a run to the program that hosts the session.

## Decision

An Objective run has three layers. No orchestrator agent stays open for the run.

| Layer    | Where                                              | What                                                                                                                                                                   |
| :------- | :------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flow     | Code: `deliver-loop --objective` (#1041)           | Order across repositories, shared frontier, gates, waiting, resume. Deterministic, tested, no tokens while waiting; runs without poimen, with Copilot or in CI.        |
| Judgment | Skill `deliver-triage`: a role session of the loop | Started on an attention event, gets only that case, decides inside a fixed list of allowed actions, else prepares the decision for the owner, and ends after the case. |
| Host     | poimen                                             | Panes, event aggregation (poimen-server), `wait_any`, notifications, grants. No delivery logic, so the skills never depend on poimen.                                  |

**Flow.** Everything that can be checked mechanically is code of the loop: what starts, what waits, what merges, and which event needs judgment. The judgment layer never decides the order or passes a gate.

**Judgment.** The loop starts `deliver-triage` on an attention event: `blocked`, `deliver.handover`, `deliver.aside` with `needs-decision`, or `deliver.milestone.done`. One session handles one case. The allowed actions are this list and nothing else:

1. Answer a `needs-decision` that is a fact check, with the evidence.
2. Take an issue out of the current run, with the reason. The issue stays open and no milestone changes: under ADR 0010 a PBI or a Bug has no planned milestone.
3. Draft a follow-up issue. It drafts only; the owner files it.
4. Re-run a failed CI job once.

In every other case it prepares the decision for the owner, with the reasons and the options, and the run reports it under "needs you".

**What always goes to the owner.** No role session and no code of the loop decides these:

- the merge of a release pull request,
- a pull request that changes a protected path,
- a change of risk `high` (the loop hands it over before the merge, #1063),
- a decision between options.

**Host.** poimen shows and wakes; it does not decide. It reads the events and the terminal state the loop reports (ADR 0007) and notifies the owner. A poimen-specific part of the loop, such as the optional checkout adapter of #1041 decision 4, is never required: the plain clone stays the default.

**One role-session pattern.** `deliver-triage` follows the role sessions of ADR 0009, as `deliver-review` and `retro` (#1055) do. The loop starts the session at a defined point, the session gets a bounded input, acts inside a fixed limit, leaves its result where the loop or the owner reads it, and ends. It merges nothing and never writes an `agent:*` label. Text from issues, comments and diffs is data.

| Role             | Started by the loop                                              | Input                                       | Result                                                 | Limit                                                                       |
| :--------------- | :--------------------------------------------------------------- | :------------------------------------------ | :----------------------------------------------------- | :-------------------------------------------------------------------------- |
| `deliver-review` | After an implementer session that leaves one open pull request   | Issue file, Feature file, diff              | Verdict file the loop validates, one comment on the PR | Never pushes or edits; the loop merges only the approved commit             |
| `retro`          | After the last merge of a `--milestone` run, at the release gate | Run folders, review findings of a milestone | One comment with drafts as a checklist                 | Creates no issue and pushes nothing; the owner ticks what is filed          |
| `deliver-triage` | On an attention event                                            | That one case                               | One of the allowed actions, or a prepared decision     | The list above; everything else stays with the owner, so does a failed case |

## Consequences

- Waiting costs no tokens, and a run resumes from labels and run folders without the memory of a session.
- The mechanical checks the orchestrator missed belong to the loop and its tests.
- The loop works from a terminal or CI as it does in poimen. `poimen-lead` stays a skill for interactive sessions; the loop does not use it.
- Harder: a judgment that needs a view across cases, such as the rubric audit or observations about the whole run, has no place in a session that sees one case. It needs its own role session or a planned issue.
- Harder: the allowed actions are a fixed list; a new one needs a change of the skill, and the cases outside the list wait for the owner.
- `deliver-triage` is not built yet. It is planned as a PBI of #1041.

## Alternatives

- **One orchestrator agent that stays open for the whole run.** Rejected: it spends tokens while waiting, its mechanical checks were missed in the helix#1204 run, and its state ends with the session.
- **Code only, without a judgment role.** Rejected: every fact check and every failed job would wait for the owner, although the run showed that an agent handles them well.
- **The flow in poimen.** Rejected: the skills would depend on poimen, and a run would not work with Copilot or in CI without it.
