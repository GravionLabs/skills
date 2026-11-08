# ADR 0002: Displays read the progress events

- Status: Accepted; the in-repo schema and fixtures as the contract for readers (lines 53-54) superseded in part by [ADR 0003](0003-the-progress-event-format-lives-in-agent-events.md)
- Date: 2026-11-07
- Issues: #413, #395
- Supersedes in part: [ADR 0001](0001-agent-progress-events.md) (the terminal sink of the emitter; the event format, `tone`, the location, the retention and the reference reducer stay)

## Context

ADR 0001 made progress events the contract between skills and displays: one JSONL file per run under `<git-common-dir>/.agents/events/`, written by `Report-Progress.ps1`, with `tone` decided once and the reference reducer `ConvertFrom-ProgressEvents.ps1`. It is implemented (#369–#375).

To keep herdr and poimen working unchanged during that switch, ADR 0001 left a **terminal sink** in the emitter: after the append, `Report-Progress.ps1` derives the tokens and the agent state from the event and pushes them through `TerminalBackend.ps1` (`herdr pane report-metadata`/`report-agent`, `poimen-server report …`). That was a migration step, and it has costs:

1. **The skills carry display knowledge.** The skills repository ships the herdr and poimen adapters, the token table of `references/terminal-backends.md` and the owner rule (`AGENT_EVENTS_TERMINAL=owner`) that keeps nested emitters quiet. Every display change is a skills release.
2. **Push is lossy.** A display that starts late or restarts gets only the tokens that are still within herdr's TTL; a crashed run leaves its tokens until the TTL ends.
3. **The events already hold everything.** `run.started` names the host (`poimenTerminal`, `herdrPane`), every event carries `tone` and `needsYou`. A reader needs nothing the sink knows.

The proposal to move the emitter, the sink and one shared reducer into a Rust binary `keryx` (with an MCP server) was worked out and is listed under Alternatives. Seen from the readers it buys little: herdr plugins are TypeScript and need a handful of tokens, poimen is Rust and needs the full fold, so a shared crate has one consumer.

Constraints:

- herdr plugins are short-lived commands (actions, panes, `[[events]]`, `[[startup]]`); herdr has no file event and no long-running plugin process. Tokens and agent state are set through the herdr CLI, which any process may call.
- poimen is a long-running process that knows the cwd of every terminal; GravionLabs/poimen#480 already moves its Deliver panel from `status.json` to the events.
- The Claude Code sandbox, cloud and container runs: writes stay inside the git directory (unchanged from ADR 0001).

## Decision

The emitter only writes. **Every display reads the event files and derives its own view; nothing pushes display state from the skills.**

```
Report-Progress.ps1, the loop  ──append──▶  <git-common-dir>/.agents/events/<run>.jsonl
                                                    │ replay + follow
                     ┌──────────────────────────────┼─────────────────────────┐
              poimen (Rust)              herdr watcher (herdr-plugins, TS)   agents (pwsh)
              full fold, #480            tokens + agent state per pane       Get-RunState
```

### Emitter

- `Report-Progress.ps1` appends the event and returns. The terminal sink (`Send-TerminalSink`, `-SinkEvent`) and the owner rule (`AGENT_EVENTS_TERMINAL`) are removed.
- `TerminalBackend.ps1` keeps only what is loop UI, not event display: `Get-TerminalBackend`, `Test-LoopTerminal`, `New-LoopWorkspace`, `Open-LogPane`, `Switch-LogPane`, `Test-LoopAgentConflict` (for the loop's own conflict notice). `Set-LoopTokens`, `Clear-LoopTokens`, `Set-LoopAgentState` and `Clear-LoopAgentState` leave the skills.

### poimen

Reads and follows the event files of each terminal's repository and folds them with its own reducer (#480). `poimen-server report tokens|clear|agent` is no longer used by deliver.

### herdr

A plugin in GravionLabs/herdr-plugins follows the event files of the open workspaces and sets the tokens `deliver`, `deliver_step`, `deliver_pr`, `deliver_progress`, `deliver_tone` and the agent state on the pane named by `run.started` (`host.herdrPane`), with the same names, source and TTL as today. It clears them on `run.finished` and when a run turns `abandoned` (ADR 0001 rule). The `[[startup]]` hook starts one watcher per herdr server (lock file in `HERDR_PLUGIN_STATE_DIR`); the plugin's design is decided in herdr-plugins. Sidebar rules (`deliver_tone`, GravionLabs/herdr-plugins#220) keep working because the token names stay.

### The contract is the schema and the fixtures, not shared code

- The event schema and the paired fixtures (events → `*.state.json`, #370) are defined in GravionLabs/agent-events and consumed at its pinned tag; full readers read that contract, not a copy here (ADR 0003).
- **Token fixtures** under `test/skills/delivery/fixtures/progress-events/`: events → expected tokens and agent state per step. They replace the sink table of `references/terminal-backends.md` as the checked source; the herdr plugin tests against them. They stay out of ADR 0003 and move with the herdr plugin work.
- Each reader implements its own fold in its own language: pwsh (reference), Rust (poimen), TypeScript (herdr). The schema only grows additively (ADR 0001), so the folds stay small.

### Agents

Agents with a shell read runs through a pwsh command over the reference reducer (`Get-RunState.ps1`: list runs, fold one run, events after a `seq`), with one allowlist entry. An MCP server (#395) is deferred until a client without a shell (Claude Desktop) or a supervisor across repositories needs it; it then reads the same files and is checked against the same fixtures.

### Migration

For one minor release the sink stays behind `DELIVER_TERMINAL_SINK=1` (default on), so herdr and poimen users without the new reader keep their display. Sink and readers set the same values under the same source, so running both side by side is harmless. The next minor release removes the sink and the variable.

## Consequences

- Easier:
  - The skills repository no longer knows how herdr or poimen show a run; display changes are releases of herdr-plugins or poimen.
  - A display that starts late or restarts replays the file and shows the whole run; no stale tokens after a crash.
  - No compiled prerequisite and no new repository; keryx stays archived.
  - The owner rule for nested emitters disappears, since nothing reports per emitter.
- Harder:
  - herdr gets its tokens only while the plugin's watcher runs. herdr gives it no lifecycle, so the plugin owns lock, restart and the discovery of new workspaces.
  - Three folds in three languages; a fixture missing a case lets them drift. Every new event type or token comes with fixtures.
  - Users of herdr need the plugin for the deliver tokens; without it the sidebar shows no deliver state (the events are written anyway).
  - Agents without a shell still cannot read runs until the MCP server comes.
- Follow-ups:
  - skills (Feature #413): token fixtures (#414); `Get-RunState.ps1` with allowlist entry (#415); sink behind `DELIVER_TERMINAL_SINK` (#416), then removal of the sink, the owner rule and the token functions of `TerminalBackend.ps1` (#417); docs with each PBI.
  - herdr-plugins: event watcher with tokens and agent state, tested against the token fixtures (GravionLabs/herdr-plugins#221).
  - poimen: #480 reads the events; drop the deliver use of `poimen-server report`.
  - #395 stays open as the deferred MCP server.

## Alternatives

### Rust binary `keryx` owns write, notify and read

GravionLabs/keryx is unarchived as a Rust workspace: `keryx emit` replaces the pwsh emitter and carries the sink, a crate `keryx-events` holds the one reducer, `keryx state`, `keryx mcp` (stdio) and `keryx watch` read. Distributed as prebuilt binaries (cargo-dist: GitHub Releases, Homebrew, npm for `npx`).

- For: one reducer, agents read through MCP without knowing paths, the skills lose the adapters.
- Against: a compiled prerequisite on the write path, where a missing binary means no events; releases for three platforms and a version range in the skills for about 700 lines of pwsh; the crate has one Rust consumer (poimen), the herdr plugins are TypeScript; it revives a repository archived on 2026-10-29 without a second user for it. The sink still pushes, so problems 2 and 3 of the Context stay.

### Read side only in keryx (crate, `state`, `mcp`, `watch`), emitter stays pwsh

- For: keeps writing free of the binary; one reducer for poimen and the MCP server.
- Against: still a repository and binary distribution for one Rust consumer, before any agent without a shell asks for MCP. It can follow this ADR later, reading the same files.

### Background MCP service

`keryx serve` over Streamable HTTP on localhost, started by the first client, storing the events itself. Rejected for the reasons of ADR 0001 and of the keryx proposal: the scripts are not MCP clients, the sandbox blocks local network access, cloud and container runs cannot reach a host service, a crash cuts every writer.

### Keep the sink in the emitter (ADR 0001 as is)

No work, but the three costs of the Context stay, and every new display needs a skills change.

### herdr reads the files natively

The cleanest for herdr, but herdr has neither a file event nor long-running plugins. A request upstream stays possible; the plugin watcher does not wait for it.
