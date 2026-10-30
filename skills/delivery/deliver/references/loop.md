# Loop: a fresh session per PBI

```powershell
pwsh <skill-dir>/scripts/Invoke-DeliverLoop.ps1 -Milestone 0.13 -Max 5
pwsh <skill-dir>/scripts/Invoke-DeliverLoop.ps1 -Target 860,870 -Model opus
```

Run it from the repository root. It starts `claude -p "/deliver <targets> --unattended --max 1" --model <model> --permission-mode auto --output-format stream-json --verbose` once per PBI (`-Model` default `sonnet`, `-Harness claude` is the only harness). The allowlist is `references/permissions.md`; the script checks nothing more.

## Loop or one session

- One `/deliver` session: a few PBIs, you watch, interactive questions are welcome.
- The loop: a whole release or a Feature overnight. Each PBI starts with an empty context, a dead session (sleep, crash, rate limit) costs one PBI, and `deliver` keeps all state in GitHub, so there is no queue file.

## Stop rules

Checked from GitHub (not from the output) before and after each iteration, on the open PBIs of the targets without `needs-decision` / `needs-refinement`:

| Result      | When                                                                                | Exit |
| :---------- | :---------------------------------------------------------------------------------- | :--- |
| done        | no open PBI left                                                                    | 0    |
| max reached | `-Max` iterations ran (delivered, blocked or paused PBIs in total)                  | 0    |
| blocked     | open PBIs remain, all wait on an open blocker or a label                            | 2    |
| no progress | the set did not change after an iteration; prints the last log lines, never retries | 1    |

## Observability

- `.agents/deliver-loop/<run>/<nr>.jsonl`: every stream record as it arrives (git-ignored). `<nr>` is the first ready PBI at the start of the iteration.
- `.agents/deliver-loop.log` and stdout: `HH:MM:SS <tool> <description or file>`, short assistant text, tool errors with `✗`; subagent steps carry the agent description as prefix (`[Review PBI #401 diff] Bash …`).
- Notifications (macOS `osascript`, Windows toast, else none): PR opened, review fix round, CI red, paused, blocked, merged, and the loop result.
- herdr (`HERDR_ENV=1`): the loop reports `deliver 3/7 #401 review: clean` per progress line and clears it on exit, Ctrl+C or error; see `references/herdr.md`.
