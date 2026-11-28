# Tree flow

A Feature, an Epic or a milestone (its Features): one leaf lead (`/deliver-lead <leaf>`) per open PBI and Bug of the whole tree, flat, never a lead for a level in between. `scripts/step.mts tree` asks the gate `next-issue` before every start; the lead executes what it returns and keeps no list of leaves. The verbs are the contract of [host-verbs.md](../../deliver/references/host-verbs.md); the adapter loaded in step 2 maps them to the host.

## Actions

Execute exactly the one action of the line, with its fields, then pass its outcome back.

| `do`            | Execute                                                                                                      | Outcome (`--result` file)                                                                                                                           |
| :-------------- | :----------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------- |
| `start-worker`  | start one leaf lead with `name`, `brief`, `model` and a worktree of its own (below)                          | `{ "handle": "…", "name": "<its name>" }`; refused or failed: `{ "name": "<its name>", "error": "<reason>" }`                                       |
| `wait-any`      | wait for the first of `handles`, at most `timeout` seconds; no `handles`: wait `timeout` seconds (see `why`) | `{ "handle": "…", "state": "done" }`; `state` also `blocked` (add `question`), `error` or `gone`; no worker ended in time: `{ "state": "timeout" }` |
| `read-result`   | read the final report of `handle`; with `question` the leaf lead is blocked (below)                          | `{ "handle": "…", "report": "<text or path>" }`; none: `"report": ""`; with `question`: `{ "handle": "…", "answer": "sent" }`, `refused` or `owner` |
| `answer-worker` | send the text to its worker                                                                                  | `{ "handle": "…" }`; refused: add `error`                                                                                                           |
| `ask-owner`     | ask the owner the question with its options                                                                  | the answer in `report`; no answer: `error` `deferred`                                                                                               |
| `end`           | nothing: the run is over                                                                                     | none; report `report`                                                                                                                               |

## Starting a leaf lead

- `brief` goes to the worker unchanged. `model` is resolved from the `Tier:` of the leaf: pass it as it is.
- The worktree is a fresh one on `branch`, starting from `base`. A host that cannot start it from there: append to the brief the commands that fetch and check out that.
- A leaf lead starts workers of its own, so it needs a host session that can: one that cannot says so in its report, and the leaf stays open.
- Up to `deliver.parallel` leaf leads run at once (default 1). The script names the next start; never start one yourself.

## Waiting

`timeout` covers the whole wait. When the host's wait returns earlier without a state, wait again. After `done`, `read-result`; what the report says is not used: the script reads from the tracker whether the leaf is delivered. A leaf that is not delivered is not started again in this run.

A `read-result` with `question`: a question about the flow of the work is answered with `answer-worker`, then `"answer": "sent"` or `"refused"`. A permission, secret or credential question, or one only the owner can decide: never answer it, pass `"answer": "owner"` with the `question`. That leaf lead is no longer waited for, but keeps its place until its leaf is delivered.

## Resume

A new lead passes `--resume` on its first call with the run id of the lead before. The leaf leads of that lead are gone: never wait for their handles. The open leaves are read from the tracker again, and a new leaf lead resumes its leaf from the `agent:*` label.

## End

`report` holds `ref`, `outcome` (`done`: no leaf is open; else `held`), `reason`, `delivered`, `waiting` (each held leaf with its reason) and, for a milestone whose tree is done, `release`: the word of the gate `release-gate`, run once per run, its `reason`, the `retro` comment or the `retroCommand` still to run (named, not run). A person decides what follows; never work around a gate.
