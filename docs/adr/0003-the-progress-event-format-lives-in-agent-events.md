# ADR 0003: The progress event format lives in agent-events

- Status: Proposed
- Date: 2026-11-08
- Issues: #451, #450
- Supersedes in part: [ADR 0001](0001-agent-progress-events.md) (the location of the schema and the fixtures; the emitter, the tone rules and the retention stay as decided there), [ADR 0002](0002-displays-read-the-progress-events.md) (the in-repo schema and fixtures as the contract for readers, lines 53-54; the reader-not-pusher decision and the terminal sink stay as decided there)

## Context

ADR 0001 put the event schema in this repository, as `schema/progress-event.schema.json` of the `deliver` skill, and named its raw URL on `main` as the public address. The paired fixtures (events to state) were to live under `test/`. The consumers of the format are not in this repository: the poimen Deliver panel (Rust and TypeScript) and herdr rules read the events and need the same schema, the same reducer cases and the same rules for evolving the format.

GravionLabs/agent-events holds the contract: the event schema, the run state schema, the fixtures and the specification (`SPEC.md`). The version this repository pins is v0.2.0 (#452; v1.0.0 was named here before the tag existed): the core (`schema/v0/`), its fixtures and `SPEC.md`. The deliver profile (`deliver@1`) lives with its owner, this repository, as agent-events asks of profiles. A contract that several repositories read should have one home that none of them owns, with versions a reader can pin. The raw URL on `main` of a skill moves with every commit and says nothing about the version a reader was built against.

The scope is the format only. The emitter (`Report-Progress.ps1`), the reference reducer (`ConvertFrom-ProgressEvents.ps1`), the tone rules, the transport and the retention stay in this repository as ADR 0001 decided. The event format v1 does not change. The token fixtures (`*.tokens.json`) belong to the herdr plugin work and stay out of this decision.

## Decision

The progress event format is defined in GravionLabs/agent-events. This repository consumes it at a pinned tag.

- The event schema, the run state schema, the fixtures and `SPEC.md` live in agent-events. The copies in this repository are replaced by the pinned release; the schema is not edited here any more.
- This repository pins a tag (`v1.x.y`) and takes the schema and fixtures from it. A bump of the pin is a reviewed change of this repository.
- Readers, including poimen, pin a tag in the same way and never follow a branch.
- The schema only grows additively within `v1`: fields and types are added, readers ignore unknown fields and unknown types. A change in meaning bumps `v`, as in ADR 0001.
- The emitter and the reference reducer stay here and are tested against the fixtures of the pinned tag. The tone rules (which event gets which `tone`) stay a decision of this repository; agent-events documents the resulting values.
- ADR 0001 stays in force for everything not named above. Its header points to this ADR for the location of the schema.

## Consequences

- Easier:
  - poimen, herdr rules and the skills read one schema and run the same fixtures.
  - The version a reader supports is a tag, not a commit on `main`.
  - The spec is written for implementers who never open this repository.
- Harder: readers pin a tag, so a schema change touches two repositories. It is released in agent-events first, then this repository bumps its pin, and each other reader does the same when it needs the new field.
- Harder: the emitter and the schema can drift between a release of agent-events and the pin bump. A test of the emitter against the pinned fixtures and schema makes the drift fail in CI.
- Harder: a contributor who changes the event format opens a change in agent-events before the change here.
- The format v1 and the files written by existing runs stay valid. No migration is needed.

## Alternatives

- **The schema stays in skills.** No new repository and no pin. But poimen and herdr consume the schema of a skill repository, with a raw URL on `main` as the only version, and the fixtures and spec have no natural home there.
- **The schema lives in poimen.** The main consumer would own it. But skills would then depend on an application repository for the format they emit, and other readers such as herdr rules would depend on poimen as well.
- **Shared code instead of a spec.** One library that emits and reduces events. The skills are PowerShell, poimen is Rust and TypeScript, so each language needs its own library, and the library, not a document, becomes the contract. A schema, fixtures and a spec let each side keep its own implementation and check it against the same cases.

## Implementation (#452)

`test/skills/delivery/agent-events/` is a copy of the pinned tag (`VERSION`, `schema/`, `fixtures/`); `test/skills/delivery/agent-events.test.ts` compares it with the tag through `gh api` (skipped offline, `AGENT_EVENTS_VERIFY=1` makes it mandatory). The emitter, reducer and `Get-RunState.ps1` tests read it through `test/helpers/agent-events.ts`. The `$id`s are the agent-events raw URLs; the schemas are removed from `skills/delivery/deliver/schema/`.
