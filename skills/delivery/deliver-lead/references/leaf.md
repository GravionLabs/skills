# Leaf flow

One PBI or Bug: implemented, reviewed, guarded and merged. `scripts/step.mts` runs the flow and its gates; the lead executes what it returns. The verbs, their results and failure cases are the contract of [host-verbs.md](../../deliver/references/host-verbs.md); the adapter loaded in step 2 maps them to the host.

## Actions

`do` is a verb of the contract, or `end`. Execute exactly the one action of the line, with its fields, then pass its outcome back.

| `do`            | Execute                                                                          | Outcome (`--result` file)                                                                                   |
| :-------------- | :------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------- |
| `start-worker`  | start one worker with `name`, `brief`, `model` and a worktree of its own (below) | `{ "handle": "…" }`; refused or failed: `{ "error": "<reason>" }`                                           |
| `wait-any`      | wait for the first of `handles`, at most `timeout` seconds                       | `{ "handle": "…", "state": "done" }`; `state` also `blocked` (add `question`), `error`, `gone` or `timeout` |
| `read-result`   | read the final report of `handle`                                                | `{ "handle": "…", "report": "<text or path>" }`; none: `"report": ""`                                       |
| `answer-worker` | send the action's text to its worker                                             | `{ "handle": "…" }`; refused: add `error`                                                                   |
| `ask-owner`     | ask the owner the action's question with its options                             | the answer in `report`; no answer: `error` `deferred`                                                       |
| `end`           | nothing: the run is over                                                         | none; report `report`                                                                                       |

Every outcome of a verb that concerns a worker names its `handle`: an outcome without it is not read.

## Starting a worker

- `brief` goes to the worker unchanged. `model` is already resolved: pass it as it is.
- Implementer: the worktree starts from `base`; the worker works on `branch`.
- Reviewer: the worktree is detached at `head`, a fresh one, never the implementer's.
- A host that cannot start a worktree from a branch or commit: append to the brief the commands that fetch and check out what the line above names.
- `env` names the files the worker writes. Create their folders if missing; set the variables if the host can, else the brief already names the paths.

## Waiting

`timeout` covers the whole wait. When the host's wait returns earlier without a state, wait again; send `timeout` only once that time has passed. Pass `blocked` back with the question: never answer a worker unless an action says so.

## Resume

Call the script with the same run id and no `--result`: it repeats the pending action. If it is `start-worker` and a worker of that `name` already exists on the host, pass its handle instead of starting a second one.

## End

`report` holds `issue`, `outcome` (`merged`, or `ended` without a merge), `reason` and, when known, `pr`, `gate` with its word `result`, and `backmerge`. After `ended`, a person decides the next step; never work around the gate.
