# ADR 0012: Delivery runs as host-neutral workflow skills next to the loop, with gates in scripts

- Status: Accepted
- Date: 2026-11-28
- Issues: #1041, #1137
- Supersedes: [ADR 0011](0011-objective-runs-in-three-layers-loop-code-deliver-triage-poimen-as-host.md) in part: the rejection of an orchestrator agent and the rule that the flow lives only in loop code
- Builds on: [ADR 0010](0010-milestones-hold-features-as-a-roadmap-and-record-what-a-release-shipped.md), [ADR 0005](0005-the-deliver-loop-runs-as-typescript-on-node-behind-a-host-interface.md), [ADR 0009](0009-deliver-loop-runs-role-sessions-and-keeps-the-stage-in-labels.md)

## Context

ADR 0011 put the whole flow of a run into `deliver-loop` code and rejected an orchestrator agent for three reasons: it spends tokens while it waits, its state ends with its session, and it missed mechanical checks in the helix#1204 run (a failed publish job, merged pull requests of risk `high`).

Since then the hosts changed. poimen's `wait_any` wakes a lead on agent and run events instead of polling, and `record_run`/`read_run` keep a lead's state outside its session. Orca offers the same kind of primitives (runs, task dependencies, dispatch ids, `worker_done`, a wake of the coordinator), and so do Claude Code agent teams and GitHub Mission Control. Across these tools the pattern is the same: the host offers start, wait, read and wake; a coordinator agent decides the flow; deterministic checks stay outside the agent. No protocol standardizes orchestration: the MCP roadmap of 2026-11-16 covers Tasks and messaging primitives, not agent-to-agent orchestration.

Two of ADR 0011's reasons are answered by the hosts. The third, missed mechanical checks, is the failure class that MAST ("Why Do Multi-Agent LLM Systems Fail?") finds most often: verification and termination, not the single agent.

The loop stays needed. poimen is delivered by the loop (poimen#742), runs in CI and with Copilot have no desktop host, and `deliver-loop.mts` holds the hardened gates. `deliver-loop --objective` (#1041) is half built.

## Decision

Delivery has one flow, two kinds of executors and one set of gate scripts.

**Gate scripts.** Every mechanical check is a small script that both executors call. Its result is a **string**: the script prints one JSON object (`result`, `reason`, `evidence`), and `result` is one of five words. An executor reads that word. The exit code carries the same result for shells and CI, which see only numbers (an exit status is an integer from 0 to 255). The numbers above 1 are the BSD `sysexits.h` codes for the same meaning, which `resolve-model.mts` already uses for a usage error (64).

| `result` | Exit | Meaning                                                                                                          | The executor                                   |
| :------- | :--- | :--------------------------------------------------------------------------------------------------------------- | :--------------------------------------------- |
| `pass`   | 0    | the check holds                                                                                                  | goes on                                        |
| `fail`   | 1    | the check failed                                                                                                 | sets the issue aside, raises an attention      |
| `usage`  | 64   | wrong arguments or config (`EX_USAGE`)                                                                           | stops and reports; never retries               |
| `retry`  | 75   | not yet: checks pending, pull request not mergeable yet (`EX_TEMPFAIL`)                                          | waits for an event or backs off, runs it again |
| `owner`  | 77   | the owner decides: protected path, risk above `mergeRisk`, release pull request, choice of options (`EX_NOPERM`) | hands over; never merges                       |

A script whose JSON and exit code disagree, or that prints no JSON, counts as `fail`.

The first scripts come out of `deliver-loop.mts`: `guard`, `verify-verdict`, `merge-approved`, `merge-base`, `stage`, `next-issue`, `objective plan`, `release-gate`, `app-token`, `merged-meanwhile` and `limits`. The loop calls them too, so a rule has one implementation.

**Executor 1: `deliver-loop`.** It stays the executor that needs no host: CI, Copilot, runs without a desktop, and the poimen repository. #1041 is finished as planned, except the poimen space adapter (#1129), which is closed, and `deliver.parallel`, whose default is 1.

**Executor 2: the workflow skill `deliver-lead` on a host.** `deliver-lead <issue>` takes any issue and picks its flow by the label: a PBI or a Bug (a leaf) is implemented, reviewed, guarded and merged; a Feature or an Epic is worked as a frontier over the leaves of its tree in `blocked-by` order; an Objective adds the order across repositories (`Requires:`) and the waits for releases. A milestone is no unit of work (ADR 0010): a milestone as input stands for its Features. The flows describe numbered steps in neutral verbs: start a worker in its own worktree, wait for the first of several, read a result, answer a worker, ask the owner. A host adapter skill maps the verbs to one host: `host-poimen` (MCP tools), `host-orca` (Orca CLI), `host-claude-code` (Agent tool). A step that needs a decision calls a gate script and acts on its `result`; the skill never decides a gate by reading the pull request itself.

**Dependency direction.** The skills know hosts only through adapters. A host never knows the delivery skills. A host may ship a skill about its own tools (poimen#1344, Orca `skills get`); the adapter points to it.

**State.** The state of a run lives in the `agent:*` labels (ADR 0009) and in agent-events, never only in a host's run store. Any executor on any host can resume a run.

**Small and flat leads.** A leaf lead handles one PBI or Bug and ends. A lead of a Feature, Epic or Objective starts the leaf leads of its whole tree itself, never a lead per level below it; it only starts, waits and resumes from labels and events.

**Merge target.** Only leaves open pull requests. `merge-base <issue>` decides the target: `release/next` by default, also for a PBI or a Bug without a parent; `main` only for a Bug marked as hotfix, through the hotfix path (`fix/<nr>-<slug>` from `main`, then `main` into `release/next`). A merge into `release/next` sets the milestone (ADR 0010).

**Retro.** Once per release, at the release gate of `release/next`, by whichever executor reaches it; not per Feature.

**Parallelism.** Serial per base branch by default, parallel across repositories. A session that starts after a foreign merge on its base gets `merged-meanwhile`: the merged commits and files since its workspace was created.

**Kept from ADR 0011.** The judgment layer: `deliver-triage` is a role session with a fixed list of allowed actions, started by either executor on an attention. The list "what always goes to the owner" stays and is enforced by exit 77.

## Consequences

- A rule changes in one script and holds for both executors. A skill changes in Markdown without a release of the loop.
- Waiting costs no tokens on hosts that wake (poimen, Orca). On Claude Code alone a lead stays open while it waits.
- Gate reliability of the skills depends on the lead calling each script. `merge-approved` refuses without a valid verdict file and a passing `guard` result, so a skipped step fails closed.
- Strings in the JSON keep the skills readable; the fixed mapping to exit codes keeps shells and CI working without parsing JSON.
- Two executors of one flow can drift. The shared scripts limit drift to the order of steps; a research project tests whether both can read one declared workflow.
- Unattended runs on poimen need host work first: a grant that covers worktree starts and survives a server restart.
- helix#1274 runs on `deliver-loop --objective`; the skills are piloted on a later Objective and measured against the loop (gates taken, tokens per PBI, owner interventions).
- More artifacts to maintain: one workflow skill with a leaf and a tree flow, three adapters, about eleven scripts.

## Alternatives

- **Only the loop (ADR 0011 as is).** Rejected as the only way: every change of the flow is code, the flow cannot use a host's judgment or wake, and the loop grows into a monolith. It stays as one executor.
- **Stop #1041 and build only the skills.** Rejected: runs without poimen, the poimen repository and the next Objectives (helix#1274, nixe#734) need the loop now.
- **A declared workflow run by a neutral runner (Symphony-like `WORKFLOW.md`).** Not chosen now: it builds a workflow engine for one owner. It continues as a research project in its own repository and shares the gate scripts.
- **Skills that call poimen directly, without adapters.** Rejected: delivery would depend on poimen, and Orca or plain Claude Code could not run it.
