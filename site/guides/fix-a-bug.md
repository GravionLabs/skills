# Fix a bug

Bugs go through the skill `diagnose`. It builds a feedback loop that goes red on the bug before it forms any theory, so a fix is proven by a command, not by reading code.

## Example prompt

```text
Fix issue #57: the invoice total is wrong when a discount code is applied twice.
```

or without an issue: `Diagnose: the export job returns an empty file when the date range spans a year boundary.` The agent selects `diagnose` for words like bug, broken, failing or debug. Paste the first error line and the steps to reproduce, not the whole log; secrets and personal data are redacted before anything is quoted.

## Expected steps

1. **Feedback loop.** `diagnose` finds one command that you can run unattended and that asserts the exact symptom: a failing test at the seam that reaches the bug (command from `<lang>-test`), else a curl script, a CLI run against a fixture, a replay of a captured payload, a throwaway harness, a property loop or `git bisect run`. It tightens the loop until it is fast and deterministic, and shows the command and its red output. If no loop is possible it stops and asks for a reproducing environment, a redacted artifact or permission for temporary instrumentation; it does not guess.
2. **Minimal repro.** It runs the loop, confirms the red result is your symptom and cuts inputs, callers, config and steps until each remaining element is load-bearing.
3. **Ranked hypotheses.** It writes 3 to 5 hypotheses, each with a prediction ("if X is the cause, changing Y makes the bug disappear"), and shows the ranking.
4. **Instrument.** One probe per prediction, one variable at a time, preferably a debugger over logs. Debug lines carry a unique prefix such as `[DEBUG-a4f2]`.
5. **Fix with regression test.** The minimal repro becomes a failing test at a seam that exercises the real bug pattern. You see it fail for the right reason, the fix, the test passing, and the original loop green again. Tests follow `implementation` and `<lang>-test`.

Then continue as in [Work an issue by hand](work-an-issue-by-hand.md): `Review the current diff.`, then `Create a PR for this branch.`
