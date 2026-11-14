# ADR 0005: The deliver loop runs as TypeScript on Node behind a host interface

- Status: Proposed
- Date: 2026-11-14
- Issues: #612, #611
- Builds on: [ADR 0001](0001-agent-progress-events.md), [ADR 0002](0002-displays-read-the-progress-events.md), [ADR 0004](0004-objectives-coordinate-milestones-across-repositories.md)

## Context

`deliver` has two layers:

- **The skill**: `SKILL.md` and `references/`. An agent session follows it for one PBI (implement, review, PR, CI, merge). It needs judgement and stays prose.
- **The loop**: deterministic code that never needs a model. It reads the open PBIs from GitHub, picks the next ready one, starts a fresh harness session (`claude -p "/deliver <nr> --unattended --max 1"` or `copilot -p`), parses the session's JSONL output, emits progress events, checks the stop rules and repeats. In objective mode it does the same in rounds over repositories.

The loop is PowerShell: `Invoke-DeliverLoop.ps1` (781 lines), `ObjectiveLoop.ps1` (557), `ObjectiveRunner.ps1` (199), `Request-LoopStop.ps1` (80) and `Set-ObjectiveRunner.ps1` (74). It has grown into a program, and PowerShell fits it less with every feature:

- The core of an iteration is a child process whose stdout is parsed line by line while the event file is followed and a stop request is watched. In PowerShell this is one pipeline (`& $Harness @cli 2>&1 | ForEach-Object`) with script-scope variables and environment variables that are saved and restored by hand.
- The tests are already TypeScript (vitest). They start `pwsh` per suite through `PwshWorker`, and loop suites such as `deliver-loop-iteration` are skipped on Windows.
- The loop reaches the terminal through `TerminalBackend.ps1`, which knows herdr and poimen by their environment variables. herdr only gets bug fixes, and for poimen every function is "notice only".
- Three follow-ups need a long-lived, event-driven writer: run commands (GravionLabs/agent-events ADR 0005: the writer polls an inbox and answers with events), the pool scheduler for objectives (#606) and a display that hosts the sessions of a loop in its own panes (poimen).

poimen could host such loops itself, as a script environment in its server. That is a later step and a decision of poimen. deliver delivers poimen, so the loop must keep running without it: a broken poimen release must never stop the tool that ships its fix.

Node.js is already a core prerequisite of the skills (`check-prerequisites`). Skills are installed by copying the skill directory, without `node_modules` and without a build.

## Decision

The loop of `deliver` is rewritten in TypeScript and runs on Node. Everything that depends on where a session runs sits behind a host interface. The skill itself and the scripts a session calls do not change.

### Scope

The target is one language for the scripts of `deliver`. The port runs in three phases, each with its own PBIs:

1. **The loop**: `Invoke-DeliverLoop.ps1`, `ObjectiveLoop.ps1`, `ObjectiveRunner.ps1`, `Set-ObjectiveRunner.ps1` and `Request-LoopStop.ps1`.
2. **The event code**: `Report-Progress.ps1` (emitter), `ConvertFrom-ProgressEvents.ps1` (reducer), `Get-RunState.ps1` and `ProgressRetention.ps1`. The loop calls them most often, and a session calls the emitter at every step.
3. **The rest**: `Get-DeliverStatus.ps1`, `Get-ObjectiveStatus.ps1`, `Get-MergingPrs.ps1`, `Test-DeliverPreflight.ps1`, `Test-ContractChange.ps1` and `Remove-PbiWorktrees.ps1`.

- A session calls a ported script as `node <skill-dir>/scripts/<name>.ts` with the same parameters and the same output as the PowerShell file it replaces. `SKILL.md`, the references and the allowlist of the preflight change in the same PBI.
- One concern lives in one language at any time. A PBI that ports a script removes the PowerShell file (the loop is the one exception, see Migration). Nothing is implemented twice: until a script is ported, the TypeScript code calls the PowerShell file as a child process.
- Scripts of other skills (`github-milestone`, `github-release`, `detect-techstack`) stay PowerShell. `deliver` calls them as child processes, as it does today.

### Runtime

- Node runs the `.ts` files directly through its built-in type stripping: `node <skill-dir>/scripts/loop/deliver-loop.ts`. There is no build step and no generated JavaScript in the repository.
- Minimum Node 24. `check-prerequisites` checks the version, and the loop exits 64 with a message on an older one.
- Erasable syntax only (no `enum`, no parameter properties, no namespaces), relative imports with the `.ts` extension, Node built-ins only. The installed skill has no `node_modules`; a dependency would break the copy install.
- The code is type-checked and linted in this repository (`tsc --noEmit`, biome), like the tests.

### Host interface

The loop core knows GitHub, the stop rules and the events. It does not know how a session is started or shown. A host provides that:

```ts
interface LoopHost {
  /** Starts one harness session and yields its output records until it ends. */
  runSession(req: SessionRequest): AsyncIterable<SessionRecord>;
  /** A short notice for the person watching (today: Send-Notice). */
  notice(text: string, tone?: Tone): void;
}

type SessionRequest = {
  harness: 'claude' | 'copilot';
  model: string;
  prompt: string;
  cwd: string;
  env: Record<string, string>;
};
```

- `SessionRecord` is the parsed line of the harness output (tool step, text, progress line, stderr) and, as the last record, the exit code. The parsers for the JSONL of Claude Code and Copilot CLI belong to the core, so every host yields the same records.
- The default host `process` starts the harness as a child process, exactly as today. It needs nothing but Node and the harness.
- A host is one module under `scripts/loop/hosts/`. `DELIVER_HOST` selects it; without the variable the loop uses `process`.
- A second host for poimen (sessions in panes of the poimen server) is not part of this decision. The interface is cut so that it can be added without touching the core. Whether it lives here or the loop moves into a script environment of poimen is decided after this port, with poimen.
- The herdr functions of `TerminalBackend.ps1` (`New-LoopWorkspace`, `Open-LogPane`, `Switch-LogPane`, `Test-LoopAgentConflict`) stay PowerShell and are not ported. They go when herdr goes.

### Unchanged contract

A user and a display see no difference; a session only calls `node` instead of `pwsh` for a ported script:

- the shell command `deliver-loop` and its parameters (`-Milestone`, `-Target`, `-Max`, `-Harness`, `-Model`, `-Objective`, `-DryRun`, `stop`, `release`, `takeover`), in the same spelling
- results and exit codes (`done` 0, `max reached` 0, `stopped` 0, `no progress` 1, `blocked` 2, unknown harness 64)
- the run directory `.agents/deliver-loop/<run>/` with `progress.jsonl`, the session logs and the stop file, plus `status.json` and the logs
- the progress events (the loop stays the writer of its run; displays stay readers, ADR 0002)
- state lives in GitHub only; there is no queue file

The loop starts on request and ends with its work. It registers no scheduled task, service, autostart entry or timer, and no host may add one.

### Migration

- The existing vitest suites of the loop are the contract. Each suite runs against the TypeScript loop before the PowerShell file it covers is removed. The fixtures (`DeliverLoopFixture`, the fake `gh`) stay; the loop suites lose the Windows skip.
- Phase 1 is cut into PBIs along the files: the core loop with the `process` host first, then stop, then objective mode. Phases 2 and 3 do not block the switch of the default.
- While phase 1 is open, the shim starts the PowerShell loop and `DELIVER_LOOP_IMPL=node` selects the TypeScript loop. The PBI that completes phase 1 turns the default around. `DELIVER_LOOP_IMPL=pwsh` then selects the PowerShell loop for one more minor release, after which it is removed.
- The port is delivered with the installed PowerShell loop. A running loop uses the installed copy of the skill, not the checkout, so the port never changes the loop that delivers it.
- `AGENTS.md` ("Scripts are PowerShell 7+") gets the exception: the scripts of `deliver` are TypeScript on Node.

## Consequences

- Easier:
  - The loop is a normal async program: child process, event file and stop request are three streams, not one pipeline with shared variables.
  - The loop tests import pure functions (stop rules, tier choice, record parsers) instead of starting a process, and run on Windows.
  - Run commands of agent-events land in one place: the loop is the writer and gets an inbox check at its task boundaries.
  - A display can host a loop's sessions by providing one module. deliver does not learn the display's protocol in its core.
  - The same core can later run inside another runtime (a script environment of poimen) because it only depends on the host interface and Node built-ins.
- Harder:
  - Two languages in one skill until phase 3 is done, and two in the repository after that. A contributor has to know which side a change belongs to; the rule "one concern, one language" has to be kept in review.
  - Every call of a PowerShell script from the loop starts a `pwsh` process (emitter, reducer, status block). Today these run in-process. Until phase 2 the loop is slower by the start time of `pwsh` per call; after it the emitter and the reducer are imported.
  - Node 24 becomes a hard minimum for the loop. Until now any Node was enough.
  - No npm packages, also not the agent-events package. The reducer stays our own code, tested against the fixtures of the pinned agent-events tag (ADR 0003).
  - Every harness allowlist needs `node <skill-dir>/scripts/*` next to the `pwsh` entry. A missing entry makes an unattended session hang at a prompt; the preflight has to check it.
  - The port is a rewrite of the tool that delivers every repository: about 1,700 lines in phase 1 and about 3,700 in all. While phase 1 is open and for one release after it two loops exist, and a difference between them is a bug to find.
- Not changed: the decisions of ADR 0001 to 0004. Where they name a PowerShell file (`Report-Progress.ps1`, `ConvertFrom-ProgressEvents.ps1`), the name follows the port; this ADR supersedes nothing.
- Follow-ups: PBIs for the three phases, the shim and `check-prerequisites`, the removal of the PowerShell loop, the docs of the skill (`references/loop.md`, `references/terminal-backends.md`), and the decision about a poimen host together with poimen.

## Alternatives

- **Stay with PowerShell.** No port and no second language. But run commands, the pool scheduler and a hosted loop each add more concurrent state to a script that already works around the language, and the loop tests stay slow and off on Windows.
- **Move the loop into poimen now** (an embedded script engine in `poimen-server`, or a Rust implementation). poimen would own the sessions and the commands. But deliver would depend on the application it delivers, the script API would be designed from a single consumer before that consumer exists outside PowerShell, and the loop would no longer run on a machine or a harness without poimen. Kept open as the step after this one.
- **A poimen plugin** (poimen ADR 0007, Web Worker in the app). The worker lives in the app window: a loop would end when the app closes, and plugins never run on a remote machine.
- **TypeScript with a build** (bundled `.mjs` checked in or built on install). It would allow npm packages and older Node versions. But a checked-in bundle drifts from its source, and a build on install breaks the copy install of skills.
- **Deno or Bun.** Both run TypeScript and have a permission model or a single binary. Either is one more runtime to install on every machine, while Node is already required.
- **Python.** Available on most machines, but only an optional prerequisite here, and the tests and the agent-events reference code are TypeScript.
- **The harness's own orchestration** (for example workflow scripts of Claude Code). No code of our own, but tied to one harness; deliver has to behave the same on Claude Code, Copilot CLI and OpenCode.
