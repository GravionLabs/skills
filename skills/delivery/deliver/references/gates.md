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

| Script       | Arguments                                                                                                                  | Checks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| :----------- | :------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `limits.mts` | `<run> <issue> <kind>`; `<issue>` a number or `<owner>/<repo>#<number>`, `<kind>` `fix`, `review`, `conflict` or `timeout` | whether one more counted session may start for the issue: `pass` while the `step.started` events with `deliver.counted` = `<kind>` of the run (`AGENT_EVENTS_DIR`) are below the limit (fix rounds 2, conflict repairs 1, sessions after a timeout 1 per issue and run; review retries 1 per review round), `owner` once it is reached (fix rounds: the reason is the `needs-decision: …` of the loop), `usage` for an unknown kind or run. The loop writes the event before the session it counts starts. |
