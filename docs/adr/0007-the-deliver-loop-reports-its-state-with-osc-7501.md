# ADR 0007: The deliver loop reports its state with OSC 7501

- Status: Proposed
- Date: 2026-11-20
- Issues: #581
- Supersedes in part: [ADR 0002](0002-displays-read-the-progress-events.md) (the rule "the skills push no display state to the terminal", for OSC 7501 only)

## Context

ADR 0002 removed the terminal sink: the skills push no tokens and no agent state to herdr or poimen, displays read the progress events. That stays right for backend calls (`herdr pane report-agent`, `poimen-server report`), which tie the skills to one terminal.

OSC 7501 (Program Status Protocol, GravionLabs/poimen#680) is different: an open escape sequence `ESC ] 7501 ; state=…:app=…:title=… ST` that any terminal may understand (poimen, kitty, cmux, herdr-core) and any other ignores. The loop calls no tool and needs no backend detection. Without it a terminal cannot tell that a loop in one of its panes works, waits for the owner, is done or failed.

## Decision

The loop writes OSC 7501 records for the **root record** of its terminal, and only that.

- `working` with `app=deliver` and `title` (milestone or issues) at the run start and when an issue starts after a `blocked`.
- `blocked` with `kind=question` and `msg` (the text of the attention) on an attention that needs the owner.
- At the run end: `done` when the run succeeded; `done` with `tone=warning` and the counts as `msg` when it is incomplete (end status `blocked` or `waiting-for-handed-over`) or leaves issues that need the owner (`needs you` > 0); `error` only when the run failed (end status `failed`, the harness failed several times in a row); `idle` when the run was stopped. Nothing failed in an incomplete run, so it is no error. `tone` is only sent with `done`; a terminal that does not know the key shows `done` (GravionLabs/poimen#1152).
- `title` and `msg` are base64 of UTF-8, cleaned of control and invisible characters and cut to 192 and 2048 bytes. `progress` and child records are not used.
- The sequence goes to the controlling terminal (`/dev/tty` on Unix, `CONOUT$` on Windows), not to stdout, which an agent harness captures. Without a terminal (CI, detached) nothing is written and the loop is never stopped by it.
- `DELIVER_PROGRAM_STATUS=0` turns it off.

Unchanged from ADR 0002: tokens, sources, TTLs and backend calls stay forbidden; the events remain the source for displays that need more (steps, tasks, links); `poimen-server report` stays as it is.

## Amendment (#1066): the reason of `blocked`

The decision stays valid and gets one optional key: `blocked` carries `reason=handover`, `reason=decision` or `reason=risk-high`, so a pane host can show why the loop waits. `kind` stays `question`. A key instead of a new `kind`: a terminal that does not know `reason` ignores it and shows `blocked`. An attention with none of these causes (a release test, a red base, another set-aside) has no `reason`. After the merge of an issue of risk `high` the loop also writes `blocked` (`reason=risk-high`) until the next issue starts or the run ends. The events carry the same facts for readers of the files (`deliver.handover`, `deliver.aside` and the `attention` reasons prefixed `deliver.`, #1112); the OSC 7501 values have no prefix.

## Consequences

- Any terminal with the protocol shows the loop state without a plugin.
- A terminal and a display read two views of one run; both derive from the same loop code (the report is made where the event is emitted), so they cannot disagree on the outcome.
- A terminal that does not know OSC 7501 ignores it (unknown OSC sequences are dropped by common emulators); the risk is a few bytes in a terminal that echoes them.

## Alternatives

- Keep ADR 0002 unchanged and let each display derive the state from the events: needs a plugin per terminal.
- Call `poimen-server report` and `herdr pane report-agent` again: couples the skills to two backends, the reason ADR 0002 removed it.
