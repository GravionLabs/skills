# Reference files

Material that not every task needs moves out of `AGENTS.md` into a reference file.

## Rules

- One topic per file, under `docs/agents-md-refs/<topic>.md`.
- `AGENTS.md` names each file with the condition for reading it: `before changing X, read Y`.
- No file is read unconditionally. A file everything depends on belongs in `AGENTS.md` itself.
- A reference file is a rule file, not a map: traps and constraints, not a tour of the code.
- A reference file does not link to other reference files that must be read; list them in `AGENTS.md`.

## Example lines for `## Read before`

- Before changing the release workflow, read `docs/agents-md-refs/release.md`.
- Before adding a database migration, read `docs/agents-md-refs/migrations.md`.
