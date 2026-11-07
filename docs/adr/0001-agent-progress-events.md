# ADR 0001: Agent progress events replace status.json

- Status: Accepted; the terminal sink of the emitter superseded in part by [ADR 0002](0002-displays-read-the-progress-events.md)
- Date: 2026-11-07
- Issues: #368, #329, #331, #332
- Builds on: the terminal backend adapter of #331 (`scripts/TerminalBackend.ps1`)

## Context

`deliver` shows its progress (issue, step, result, PR, milestone progress) in three ways today:

- **Loop, push to the terminal (#331, #329).** `Invoke-DeliverLoop.ps1` reports the tokens `deliver`, `deliver_step`, `deliver_pr` and `deliver_progress`, plus the agent lifecycle, through `TerminalBackend.ps1`. That adapter sends them to herdr (`herdr pane report-metadata`, `report-agent`) or to poimen (`poimen-server report tokens|clear|agent`, GravionLabs/poimen#438). poimen no longer runs over herdr (GravionLabs/poimen#174).
- **Loop, snapshot file (#329, #332).** `.agents/deliver-loop/status.json` (`schemaVersion: 1`) holds the live state of the run. It is rewritten atomically on every change. The poimen Deliver panel reads it.
- **Interactive session.** `SKILL.md` step 4 only reports when `HERDR_ENV=1`. The agent then calls `herdr pane report-metadata` itself, with the pane id as a literal, because Claude Code denies any command that contains `$HERDR_PANE_ID`. In a poimen terminal an interactive `/deliver` reports nothing.

Where the data comes from is the same everywhere. The loop pulls the step out of free assistant text with `^#(\d+) ([\w-]+): (.*)$` (`Invoke-DeliverLoop.ps1`, `Write-TextStep`). It derives the step number (`select` 1 … `merge` 7), the attention reasons (`Get-Attention`) and the colors of the console and `.ansi.log` (`Get-StepColor`) from that text with more regexes.

This has four costs:

1. **The contract is prose.** A progress line phrased a little differently changes tokens, status, notifications and colors without any test failing.
2. **The interactive path is herdr-only skill text.** Every new backend would need more skill text.
3. **The snapshot loses history.** `status.json` keeps only the latest state. A reader that starts late or restarts cannot tell what happened in between, and an interactive session writes no snapshot at all.
4. **Every consumer guesses the meaning again.** Color, attention and "needs you" are computed in the loop from text. poimen, herdr rules and notifications each repeat the guess or do without.

Existing protocols cover other layers. AG-UI streams agent-to-UI events for an app that hosts the agent. ACP (Zed) runs between an editor and a harness. A2A handles delegation between agents. MCP progress notifications go from server to client. OpenTelemetry GenAI covers telemetry. None of them describes the domain progress of a skill: issue, step, result, PR, milestone.

## Decision

Skills and the loop write **progress events** to an append-only file per run. The events **replace `status.json`**. The live state is a projection of the events, and every display is a reader of that file or an in-process sink of the emitter.

### Emitter

`Report-Progress.ps1` in `skills/delivery/deliver/scripts/` is the only way to emit. It takes structured parameters (`-Type`, `-Issue`, `-Step`, `-Result`, `-Pr`, `-Reason`, …). It reads the run and host correlation from the environment, so the agent never has to: `AGENT_EVENTS_RUN`, `POIMEN_TERMINAL_ID`, `HERDR_PANE_ID`.

- The interactive skill runs `Report-Progress` after each progress line, in every backend. `SKILL.md` step 4 no longer names a backend, and `references/permissions.md` needs one allowlist entry instead of the herdr commands.
- The loop creates the run (`run.started`) and passes `AGENT_EVENTS_RUN` to the harness it starts, so the session appends to the loop's run. The loop emits only what it knows itself: iteration, milestone counts from `Get-DeliverStatus.ps1`, result. It no longer parses progress lines.
- After appending, the emitter runs the **terminal sink** in-process. It derives the tokens and agent state from the event and calls `TerminalBackend.ps1` (`Set-LoopTokens`, `Set-LoopAgentState`, …). Exactly one emitter per run reports to the terminal: the outermost one, the loop when there is one. Tokens, sources and TTL stay as in `references/terminal-backends.md`, so herdr sidebar rules and poimen rows keep working.

### Schema

JSON Lines, one event per line, published as `schema/progress-event.schema.json` (raw URL on `main`, like the status schema today).

- Every event carries `v` (1), `seq` (per run, gapless), `ts`, `run`, `type` and `tone`.
- The event types use the AG-UI vocabulary: `run.started`, `milestone.progress`, `issue.started`, `step.finished`, `attention`, `issue.finished`, `release.updated`, `run.finished`.
- `run.started` carries what `status.json` holds as header: `source` (`loop` or `session`), `harness`, `model`, `repository`, `milestone` (`key`, `title`, `url`), `pid` and `host` (`poimenTerminal`, `herdrPane`).
- Step events carry `issue` (`number`, `title`, `url`), `step` (`name`, `n`, `total`, `text`) and `prUrl`. `attention` carries `kind` (`pr_opened`, `review_fix`, `ci_red`, `paused`, `blocked`, `needs_you`) and `reason`. `issue.finished` carries `outcome` (`delivered`, `blocked`, `paused`, `skipped`). `run.finished` carries `result` (the values of today's status `result`).
- Rules: fields are only ever added, readers ignore unknown fields and unknown types, and a change in meaning bumps `v`.

### Tone: meaning decided once, colors per display

`tone` is one of `neutral`, `info`, `success`, `warning`, `danger`. The emitter sets it from the event's type and content, using the rules `Get-StepColor` and `Get-Attention` apply to text today: `pr_opened`, `delivered`, `run.finished done` → `success`; `review_fix`, `paused`, `no progress` → `warning`; `ci_red`, `blocked`, tool errors → `danger`; `needs_you` → `warning`, plus the flag `needsYou: true`. The table lives in the schema's documentation.

Each display maps `tone` to its own palette and never re-derives it:

- ANSI in the console and `.ansi.log`: green, cyan, yellow, red.
- poimen theme tokens, light and dark.
- herdr sidebar rules on a token.
- The urgency of a notification.

`NO_COLOR` and `-NoColor` stay a matter of the display, not of the event.

### Projection

The state that `status.json` holds today is the fold of a run's events. `scripts/ConvertFrom-ProgressEvents.ps1` is the reference reducer. `schema/deliver-run-state.schema.json` (today's status schema, renamed, without `schemaVersion`) describes its output. Paired fixtures (events → state) under `test/` let other readers, poimen's in Rust and TypeScript, check their own reducer against the same cases. `Get-DeliverStatus.ps1 -Text` stays the source of the milestone counts and is not replaced.

### Transport and location

- One file per run, `<git-common-dir>/.agents/events/<run>.jsonl` (`git rev-parse --git-common-dir`, the same place from every worktree, like `.agents/state/review-<nr>.json`), not committed. `AGENT_EVENTS_DIR` overrides it.
- A run has exactly one writer process tree. Lines are appended whole, and readers skip an incomplete last line.
- Readers find the files through the working directory they already know: the cwd of a poimen space or terminal, or of a herdr workspace.
- Readers replay a file from the start and then follow it. A restart of a display rebuilds the state without herdr's TTL and without stale snapshots.

### Lifecycle and retention

- `run.finished` closes a run.
- A run without `run.finished`, whose `pid` no longer lives or whose file has not changed for one hour, is `abandoned`. This is the same one-hour rule as today's stale `status.json`.
- On `run.started` the emitter deletes finished and abandoned runs older than 7 days and keeps at most the last 100 (`AGENT_EVENTS_KEEP_DAYS`, `AGENT_EVENTS_KEEP`). The same rule covers the stream recordings under `.agents/deliver-loop/<run>/`, which today are never deleted.
- Readers never delete.

### Migration

For one minor release the loop also writes `status.json` from the projection, unchanged against its schema, and the docs mark it as deprecated. Once the poimen Deliver panel reads the events, the next minor release removes `status.json`, its writer and the status schema's role as a file contract.

## Consequences

- Easier:
  - The progress lines in the chat stay for the human, but nothing parses them any more.
  - Interactive sessions report in herdr and poimen alike.
  - A new display is one more reader or sink, with no skill change.
  - Colors, attention and "needs you" are decided once and look the same in the console, poimen, herdr and notifications.
  - A late reader sees the whole run.
  - Tests check event files and the reducer instead of regexes over text.
- Easier: writes stay inside the repository's git directory, so the Claude Code sandbox and the default write permissions allow them. The same holds for cloud and container runs.
- Harder: the agent can forget to call `Report-Progress`. The loop still emits its own events per iteration (issue started, issue finished from GitHub state, milestone counts), so a forgotten step shows as a coarser run, not as a silent one. A test of the skill text checks that every progress line of `SKILL.md` is followed by the call.
- Harder: poimen must switch its Deliver panel from `status.json` to the events and implement the reducer (GravionLabs/poimen). The migration release bridges this.
- Harder: a display that wants every run on the machine must know the repositories or set `AGENT_EVENTS_DIR`.
- `TerminalBackend.ps1` stays, behind the terminal sink. Pushing tokens remains necessary for herdr. For poimen it becomes optional once poimen reads the events.

## Alternatives

- **Keep `status.json` and add events beside it.** Two contracts for the same state, and the snapshot still lacks history and interactive runs. The migration release has both only for a while.
- **Snapshot plus history in one file.** The file is rewritten on every change, so readers race with the rename, and history grows inside a JSON document.
- **Central directory by default** (`$XDG_STATE_HOME/gravionlabs/events/`). One place for every display, but it writes outside the project: the sandbox blocks it or asks, and cloud and container runs do not share it. It stays available through `AGENT_EVENTS_DIR`.
- **Color in the event** (ANSI codes or hex values). It ties the event to one display and to one theme, light or dark. `tone` carries the meaning and leaves the palette to each display.
- **Keep the progress-line regex as the contract.** No new script, but the four costs above stay.
- **MCP server with a `report_progress` tool.** Structured and neutral across harnesses, but it needs a server per session and its configuration in each harness. It can be added later as a second emitter of the same schema.
- **Harness hooks** (Claude Code `PostToolUse`, opencode plugins). Each harness needs its own setup, and hooks see tool calls, not domain progress.
- **Adopt AG-UI or ACP wholesale.** Both assume a host that owns the agent session. Only the AG-UI vocabulary is borrowed.
- **Socket or named pipe.** Live without polling, but nothing survives a crash or a restart of a display, and it is harder on Windows and in tests.
