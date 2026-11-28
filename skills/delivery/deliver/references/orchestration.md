# Models of the sessions an orchestrator starts

An orchestrator is a session that starts other sessions: subagents, poimen panes, loops. A subagent or pane started without a model inherits the orchestrator's model. So before every start it resolves the model of the role and passes it.

In a workflow skill, starts go through the verbs of [host-verbs.md](host-verbs.md).

## Resolve, then pass

```powershell
node <deliver-skill-dir>/scripts/resolve-model.mts <role> [--tier <fast|standard|strong>] [--harness <claude|copilot>]
```

- Run it in the checkout of the repository the session will work in: its `.agents/config.json` wins over `~/.agents/config.json`.
- `--harness` is the one of the new session (default `claude`).
- The output is the model. Claude Code agent call: pass it as `model`. poimen `start_agent`: pass it as `model`.
- The loop (`deliver-loop.mts`) resolves the model of its own sessions. Pass `--model` or `--review-model` only to override the config.
- Exit 64 (wrong role, tier or config): fix the cause. Do not start the session without a model.

## Roles of the orchestrator's own starts

| Start                      | Role        | Tier                                   |
| :------------------------- | :---------- | :------------------------------------- |
| Interactive PBI            | `implement` | the `Tier:` line of the PBI (`--tier`) |
| Independent review of a PR | `review`    | of the role                            |
| Release                    | `release`   | of the role                            |
| Planner pane               | `planner`   | of the role                            |
| Docs change                | `implement` | `--tier fast`                          |

A PBI without a `Tier:` line: no `--tier` (`standard`). "Of the role": no `--tier`, the config decides.

`deliver-loop --objective` uses the same resolver for the sessions it starts.

## Start an Objective run

`deliver-loop --objective <owner>/<repo>#<nr>` starts the run itself: no orchestrator agent has to stay open, and it resolves the models of its sessions. Start it again to resume. Use the template below only for an orchestrator you run by hand (a subagent, a poimen pane) that works the Objective around the loop.

## Start prompt template of a hand-run orchestrator

Drawn from the orchestrated run of GravionLabs/helix#1204. Fill the `<…>` parts and give it to the orchestrator session.

```text
Orchestrate the run of the Objective <owner>/<repo>#<nr>.

Scope: <repositories>. Not in this run: <issues>.
Order: waves; a repository starts after the releases it requires. Re-read each milestone before its release.
Work: deliver-loop per milestone; interactive PBIs, reviews, releases and planning in sessions you start.
Log: one comment on the Objective, first line <!-- objective-run: <repo>#<nr> -->, edited after each step:
waves with status, log, "Needs the owner".
Authorization: <what the owner allows, for example: merge an interactive PR after an independent review with
green checks>. Release PR merges, protected paths, risk high and decisions between options go to the owner.

Models: never let a session inherit your model. Before each start, run
node <deliver-skill-dir>/scripts/resolve-model.mts <role> [--tier <t>] [--harness <h>]
in the checkout of that repository and pass the output as `model` (agent call, poimen start_agent).
- interactive PBI: implement --tier <Tier: line of the PBI; none: omit --tier>
- independent review: review
- release: release
- planner pane: planner
- docs: implement --tier fast
Start deliver-loop without --model and --review-model unless you mean to override the config.
```

## Leaf driver

With `deliver.leafFlow: "step"` in `.agents/config.json` the loop delivers each PBI or Bug through the step script of [deliver-lead](../../deliver-lead/SKILL.md) (`leafStep`, imported in-process) instead of its own flow. The default is `"legacy"`; another value ends the run with exit 64 (`usage`) before a session starts. An Objective run keeps `"legacy"`.

The driver (`scripts/leaf-driver.mts`) only asks for the next action and executes it:

```text
result = none
repeat:
  action = leafStep({tracker, events, issue, run, result})
  start-worker  -> start a harness session (HARNESSES) in the issue's worktree, keep the handle
  wait-any      -> await the first session that ends, or the timeout
  read-result   -> the session's result line and report path
  answer-worker -> not offered by a child process: result "refused"
  ask-owner     -> result "deferred"
  end           -> return the report as the issue's result
```

The driver never decides, retries, skips or reorders an action and never calls a gate: it passes every outcome back unchanged as `result`. Stage labels, events, gates, limits, hand-over and merge happen inside `leafStep`.

The five verbs map to child processes in `scripts/process-host.mts` (wake kind `block`):

- `start-worker`: a harness session (`harness.mts`, the review harness for the reviewer) with the command of the brief, the issue file and the file variable of the start; the implementer works in `<repo>-wt-<nr>`, the reviewer in a fresh `<repo>-wt-<nr>-review` detached at the reviewed commit. Each session takes a slot. The handle is the session id of the run folder (`<handle>.jsonl` holds its output).
- `wait-any`: a call that returns when the first of the sessions ends (`done` with a `result:` line, else `error`), or `timeout`; without handles a plain wait. `blocked` never occurs.
- `read-result`: a report file with the result line, the exit code and the log path.
- `answer-worker`: `refused`; `ask-owner`: `deferred`.

What stays in the loop around the driver: the frontier (`next-issue`), the stop request (the sessions end, the task finishes `cancelled`), `deliver.parallel` and the slots, the rate-limit waits, the base check, the progress output, `results.jsonl`, the summary and the wait for handed-over pull requests. Steps of the repository run one at a time under its merge lock, so the run file has one writer at a time and merges stay one at a time. An item in an `agent:*` stage starts with `--resume`, so a leaf left by a lead or by an earlier run goes on from its label.
