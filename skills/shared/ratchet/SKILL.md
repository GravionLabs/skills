---
name: ratchet
description: 'Add a ratchet: a check that counts or lists the violations of one rule against a baseline that can only shrink. Use for "add a ratchet", "grandfather existing violations", "baseline a lint rule".'
---

A ratchet counts or lists the violations of one rule. The baseline file holds the violations that already exist (grandfathered); it can only shrink. New code never adds a violation, and a fixed violation must leave the baseline in the same change.

Paths are relative to this skill's directory. Node >= 22.18 runs the helper (`.mts`, no build).

## Baselines

- **Entry baseline**: a sorted file of violation keys, one per line (for example `path/to/file.ts:ruleName`). Pick keys without line numbers so unrelated edits do not make them stale.
- **Count baseline**: a JSON object key → number (for example violations per file).

## Add a ratchet

Order: a native baseline of the linter or architecture tool first, an own ratchet script second (`references/native-baselines.md`: ESLint, dependency-cruiser, ArchUnitNET, stale-entry snippet).

1. Write a command that prints the current violations: entry kind, one key per line; count kind, `key<TAB>count` per line.
2. Create the baseline once: `<command> | node scripts/baseline.mts --baseline <file> --kind entry --init`.
3. Run the check in CI: `<command> | node scripts/baseline.mts --baseline <file> --kind entry`.

## Check result

Exit 0 when the violations equal the baseline. Exit 1 on:

- a new entry or a higher count: fix the violation. A new baseline entry (or a higher count) needs reviewer sign-off; never add one to get green.
- a stale entry or a lower count: the violation was fixed, so lower the baseline in the same change with `--prune`.

Exit 2 on a usage error or a missing baseline.

## Runner

`node scripts/run-ratchets.mts [--dir scripts/ratchets] [--only <name>] [--init | --prune]` runs every `check-*-ratchet.mts` of the directory in parallel, one output block per script, exit 1 when any fails. `--init` and `--prune` are passed to the scripts. Start a script from `templates/check-example-ratchet.mts`. Details: `references/runner.md`. CI: copy `templates/ratchet.yml` to `.github/workflows/ratchet.yml` (runs the runner on `pull_request`).

## Ratchets

- `templates/check-file-size-ratchet.mts`: source files above 500 lines (`MAX_LINES`), baseline `path:lines`; lock and generated files excluded.
- `templates/check-lint-suppressions-ratchet.mts`: count baseline `path` → number of `eslint-disable`, `oxlint-disable`, `biome-ignore`, Rust `#[allow(` and `#[expect(`, C# `#pragma warning disable`. Where `eslint-suppressions.json` (ESLint bulk suppressions) exists, ESLint is skipped: that file is the native baseline, keep it shrinking with `eslint --prune-suppressions`.
- `templates/check-ts-any-ratchet.mts`: count baseline `path` → number of `: any`, `as any`, `<any>`, `@ts-nocheck` and `@ts-ignore` per `.ts`, `.tsx`, `.mts` file; comments and strings are not scanned (the two directives count at the start of a comment).
- `templates/check-skipped-tests-ratchet.mts`: count baseline `path` → number of `it.skip`, `test.skip`, `describe.skip`, `xit`, `xdescribe`, `it.todo`, Rust `#[ignore]`, .NET `[Fact(Skip`/`[Theory(Skip`, Python `@pytest.mark.skip` and `@unittest.skip` per `.ts`/`.js`, `.rs`, `.cs`, `.py` file.

## Flags

- `--init`: write the baseline from the current violations (first setup only).
- `--prune`: remove stale entries and lower counts. It never adds an entry or raises a count, and exits 1 when new violations exist.
- `--current <file>`: read the violations from a file instead of stdin.

Review rule: a diff that adds a line to a baseline file, or raises a number in it, is a blocking finding unless the issue approves it.
