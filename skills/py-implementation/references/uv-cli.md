# uv CLI flags

Which uv flag to use for running commands, managing dependencies, syncing environments and CI.

## `uv run` — which flag?

```
Freshly provisioned environment (CI)?
├─ Yes → --locked   (fail if uv.lock would change)
└─ No  → env definitely up to date?
         ├─ Yes → --no-sync  (skip sync; implies --frozen)
         └─ No  → --frozen   (skip lockfile update, sync if needed)
```

`uv sync` takes the same `--frozen` / `--locked`, plus `--no-dev` (production install), `--group <name>`, `--no-install-project`.

## Dependencies

- `uv add --dev <pkg>` → `[dependency-groups] dev` (use for dev tools)
- `uv add --optional <name> <pkg>` → `[project.optional-dependencies]` (published extras only)
- `uv lock --upgrade` / `--upgrade-package <pkg>` re-resolve; `uv lock --check` exits non-zero if the lockfile is stale (CI-safe, no writes)

## Environment variables

`UV_FROZEN=1`, `UV_NO_SYNC=1`, `UV_LOCKED=1` (good for CI env blocks), `UV_NO_PROGRESS=1`, `UV_NO_CACHE=1` — equivalent to the flags, applied to every uv command.

## Gotchas

- `--no-sync` implies `--frozen` — don't combine them
- `--locked` is an assertion for CI, not for normal dev runs
- `--frozen` silently uses stale versions — make sure `uv.lock` is committed and correct before relying on it in CI
