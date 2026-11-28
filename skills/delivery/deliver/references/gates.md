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

| Script           | Arguments                                                                                                                                                                                                            | Checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| :--------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `verify-verdict` | `<file> <pr> [--head <sha>]`: `--head` is the reviewed commit, default `HEAD` of the checkout                                                                                                                        | `pass`: a valid `approve` and the pull request is still at the reviewed commit. `fail`: `changes` (evidence `findings`, `unmet`), no or an invalid verdict file, another head (evidence `reviewedHead`, `prHead`)                                                                                                                                                                                                                                                                             |
| `guard`          | `<pr> [--head <sha>] [--risk <level> \| --result-file <file>] [--merge-risk <level>] [--tracker <name>]`: `--tracker` default `github`; `--risk` or `risk.level` of `--result-file`, a missing risk counts as medium | `owner`: a protected path (a manifest that changes only its dependencies is no hit), changed files that cannot be read, a risk above `--merge-risk`, a `--head` the pull request is not at, a push while guarded, a project config at the base that cannot be read. `deliver.protectedPaths` and `deliver.mergeRisk` (default medium) come from `.agents/config.json` at the merge base, never from the head or the checkout. Evidence carries `head`. The loop calls `guardCheck` in-process |
