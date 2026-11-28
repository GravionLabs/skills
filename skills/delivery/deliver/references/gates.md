# Gate scripts

Every mechanical check of delivery is a script in `scripts/gates/` that every executor calls (ADR 0012). Read this file before you write a gate script or act on its result.

## Result

A script prints one JSON object on one line, `{"result": "...", "reason": "...", "evidence": {}}`, and exits with the code of its word. An executor acts on `result`; the exit code carries the same result for shells and CI.

| `result` | Exit | Meaning                                                                                                          | The executor                                   |
| :------- | :--- | :--------------------------------------------------------------------------------------------------------------- | :--------------------------------------------- |
| `pass`   | 0    | the check holds                                                                                                  | goes on                                        |
| `fail`   | 1    | the check failed                                                                                                 | sets the issue aside, raises an attention      |
| `usage`  | 64   | wrong arguments or config (`EX_USAGE`)                                                                           | stops and reports; never retries               |
| `retry`  | 75   | not yet: checks pending, pull request not mergeable yet (`EX_TEMPFAIL`)                                          | waits for an event or backs off, runs it again |
| `owner`  | 77   | the owner decides: protected path, risk above `mergeRisk`, release pull request, choice of options (`EX_NOPERM`) | hands over; never merges                       |

A run counts as `fail` when it prints no JSON object, an unknown word, or a word that does not match its exit code.

## Writing a gate script

`scripts/gates/result.mts` holds the contract. A script wraps its body in `gateMain(fn)` and returns `{result, reason, evidence}`; a wrong argument throws `UsageError` (errors of `util.parseArgs` count too), and any other error becomes `fail`. Nothing else goes to stdout; diagnostics go to stderr. An executor in TypeScript runs a script with `runGate(script, args, {cwd, env})` or reads a finished run with `readResult(stdout, exitCode)`.

## Scripts

| Script      | Arguments                                                                             | Checks                                                                                                                                                                                                                                                                                                            |
| :---------- | :------------------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guard.mts` | `<pr> [--head <sha>] [--risk <level> \| --result-file <file>] [--merge-risk <level>]` | `owner` when the pull request changes a protected path (`deliver.protectedPaths`; a manifest that changes only its dependencies is no hit), its changed files cannot be read, or its risk (missing: medium) is above `--merge-risk` (`deliver.mergeRisk`, default medium); the loop calls `guardCheck` in-process |
