---
name: agents-md
description: 'Structure, size and maintain an AGENTS.md: 8 000-character budget, reference files read on a condition, admission rule for new rules. Use for "write AGENTS.md", "AGENTS.md is too big", "slim AGENTS.md", "add a rule to AGENTS.md".'
---

`AGENTS.md` holds only the rules every task needs. Everything else lives in reference files that `AGENTS.md` names with the condition for reading them.

## When to use

- A repository has no `AGENTS.md`, or its `AGENTS.md` is over budget or is a map of the code.
- Someone wants to add a rule: apply the admission rule first.
- Not for the content of a style guide (`ui-styleguide`) or decisions (`adr`).

## Target structure of a root file

Copy `templates/AGENTS.md` and fill it from the repository:

1. `## Checks`: the exact commands that must be green before a change is done.
2. `## Repo rules`: rules specific to this repository (layout limits, generated files, what never to commit).
3. `## Code style`: only what the formatter and linter do not enforce.
4. `## Footguns`: traps that cost time once and will again.
5. `## Read before`: one line per reference file, `before <changing X>, read <file>`.

## Budget

A root `AGENTS.md` has at most **8 000 characters**; a nested `AGENTS.md` follows the same limit. Count characters, not lines: a long table row hides the size. How to count and why: `references/budget.md`.

## Admission rule

Rules are traps to avoid, not maps to follow. A new rule is admitted only when it is:

- non-obvious: an agent would not find it by reading the code,
- repeatedly encountered: it has cost time more than once,
- specific enough to act on: it names the file, command or condition.

An agent never edits `AGENTS.md` inline to add a rule. It writes a section `Suggested AGENTS.md additions` in the pull request description; a person decides.

## Moving a section out

When the file is over budget or a section is only needed for some tasks:

1. Pick the section that is not needed by every task.
2. Move it to `docs/agents-md-refs/<topic>.md`, one topic per file (`references/ref-files.md`).
3. Replace it in `AGENTS.md` with one line under `## Read before`: `before <changing X>, read <file>`.
4. Count again until the file is within the budget.

## Check

```powershell
node scripts/check-agents-md.mts [repo] [--budget <n>] [--json]
```

Prints `<path>: <characters> / 8000` per `AGENTS.md` (root and nested). Exit 1 for a file over the budget, a file under `docs/agents-md-refs/` that no `AGENTS.md` names, a reference without a reading condition and a named file that is missing.

## Ratchet

A file over the budget may not grow while it is slimmed: copy `templates/check-agents-md-size-ratchet.mts` into the ratchet directory of the repository (skill `ratchet`, found by its runner). It keeps a count baseline of characters per over-budget `AGENTS.md`; growth fails, shrinking fails as stale until `--prune`, a file within the budget needs no entry.

## References

- `references/budget.md`: why characters, how to count, what to do at the limit.
- `references/ref-files.md`: the reference-file rule.
- `templates/AGENTS.md`: the skeleton.
- `templates/check-agents-md-size-ratchet.mts`: the size ratchet.
