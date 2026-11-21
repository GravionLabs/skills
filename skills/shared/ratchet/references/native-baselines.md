# Native baselines

Where a linter or architecture tool has its own baseline, use it. Write a ratchet script (`scripts/baseline.mts`) only for what no tool covers.

## ESLint bulk suppressions

- File `eslint-suppressions.json`, created with `eslint --suppress-all` (or `--suppress-rule <rule>`).
- ESLint fails on a violation that is not suppressed and on a suppression that is no longer needed (unused), so it detects stale entries itself.
- Shrink it with `eslint --prune-suppressions`.

## dependency-cruiser

- `depcruise --baseline <file> --baseline-mode shrink-only <paths>`: known violations are ignored, the baseline is rewritten only when it gets smaller.
- Needs TypeScript 7.1 and its optional platform package.
- Limit: it sees TypeScript imports, not dependencies in templates (for example Angular templates).
- Stale entries do not fail the run: the store is rewritten silently. Use the stale-entry snippet below.

## ArchUnitNET

- `FreezingArchRule.Freeze(rule, path)` stores the known violations in `path` and fails only on new ones.
- Use 0.13.5 or later: earlier versions missed dependencies inside `async` methods in Release builds.
- Limit: a fixed violation is dropped from the store silently, no failure. Use the stale-entry snippet below.

## Stale-entry check

Neither dependency-cruiser nor ArchUnitNET fails on a stale entry. Regenerate the baseline with the tool, then fail when the file changed:

```powershell
# regenerate the baseline with the tool's own command, then compare with the committed one
depcruise --baseline .dependency-cruiser-baseline.json --baseline-mode shrink-only src   # or: dotnet test (ArchUnitNET rewrites its store)
git diff --exit-code .dependency-cruiser-baseline.json
```

Exit 1 means the baseline shrank or changed: commit the regenerated file in the same change. A diff that adds an entry still needs reviewer sign-off.

## Rejected: Betterer

Not used. Last stable release 5.4.0 (2022-08-09), npm `latest` is 6.0.0-alpha.1, and it is broken on TypeScript 7 (phenomnomnominal/betterer#1255).
