# Ratchet runner

`node scripts/run-ratchets.mts [--dir <d>] [--only <name>] [--workers <n>] [--init | --prune]`

- Discovers `check-<name>-ratchet.mts` in `--dir` (default `scripts/ratchets`, relative to the working directory) and runs each with `node`.
- Runs them in parallel, at most `--workers` at a time (default: the CPU count, at most 4).
- Prints one block per script, after the script ended, so output never interleaves:

  ```
  === ratchet <name>: ok | FAILED (exit <n>) ===
  <stdout and stderr of the script>
  ```

  The block of a failing script carries the text of `baseline.mts`, which names the fix (fix the violation, or `--prune`; a new entry needs reviewer sign-off).

- The last lines give `x/y ratchets passed` and the failed names.
- `--only <name>` runs one ratchet (`foo` for `check-foo-ratchet.mts`; the full file name works too).
- `--init` and `--prune` are passed to every script that runs. A script forwards them to `baseline.mts`. Not combinable.

Exit codes: 0 all passed, 1 at least one script failed, 2 usage error (unknown flag, missing directory, no script, unknown `--only`).

## Writing a script

Copy `templates/check-example-ratchet.mts` to `scripts/ratchets/check-<rule>-ratchet.mts`. It prints nothing itself: it computes the violations, pipes them into `baseline.mts` with the flags it received, and exits with its status.
