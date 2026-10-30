# Invariants for async and stateful items

Background: error-path invariants (non-atomic state and side effect, a failing result handler leaving an intermediate state) are what a plan that only says "catch every error" leaves unnamed.

## Trigger

The item's `files` or the exploration summary show background/async work, persistence or a state machine. Other items get no section.

## Checklist

1. A state change and its side effect (message, event, file) are atomic or compensated.
2. An error in the error or fallback handler leaves nothing in an intermediate state.
3. Every external process or network call has a timeout.
4. Background work can be awaited in tests.
5. Every background error is logged and mapped to a defined state.

## Wording

Include only the items that apply, each worded for that item (named state, function, table, file), never the generic list.

## Placement

- Level `pbi`: PBI body, template sections, then `## Invariants` directly before `## Definition of Done`.
- Level `task`: Task body, `## Invariants` after Implementation Notes and before `<!-- agent-ready:start -->`.
- Single-task plan (no Task issue): the same position inside the single `plan.json` item `body`.

The implementer covers each invariant with a test (`implementation` skill).
