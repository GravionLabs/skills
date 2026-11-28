# Migrating from the PowerShell loop

`deliver-loop` used to be `Invoke-DeliverLoop.ps1` with the old `deliver` skill. Since [#693](https://github.com/GravionLabs/skills/issues/693) the `deliver` skill delivers one issue and `scripts/deliver-loop.mts` is the loop (Node 24 or newer, no build). The old skill, the PowerShell loop and the Objective mode are kept on the branch `archive/deliver-v1`.

## Steps

1. Update the skills: `/skills-manage update`.
2. Make sure `node --version` prints 24 or newer.
3. Run `pwsh <skill-dir>/scripts/Install-LoopShim.ps1` of `skills-manage`. It writes the launcher file and removes the old shell function ([the command](deliver.md#the-deliver-loop-command)). Open a new terminal.
4. Replace the parameters below in your scripts and aliases.

## Parameters that changed

| PowerShell loop                    | `deliver-loop`                                                        |
| :--------------------------------- | :-------------------------------------------------------------------- |
| `-Milestone M004`                  | `--milestone M004`                                                    |
| `-Target 12,15`                    | `--issues 12,15`                                                      |
| `-Max 5`                           | `--max 5`                                                             |
| `-Model <name>`                    | `--model <name>`                                                      |
| `-Harness copilot`                 | `--harness copilot`                                                   |
| `-DryRun`                          | `--dry-run`                                                           |
| none (the base was `release/next`) | `--base <branch>`, or `deliver.base` in `.agents/config.json`         |
| none                               | `--allow-no-required-checks`, `--trust-authors`                       |
| `deliver.sessionTimeoutMinutes`    | `--session-minutes` (default 90) and `--merge-minutes` (default 30)   |
| `DELIVER_MIN_<X>`                  | `DELIVER_<X>`; the old names work for one more release with a warning |

Flags use two dashes and lower case.

## What is gone

- **Objective mode** (`-Objective`, `takeover`, `release`, `deliver.parallel`): one loop runs one repository. Run the loop in each repository, or start several by hand.
- **Claims.** The loop does not assign issues or read assignees. Run one loop per repository at a time.
- **Preflight.** `Test-DeliverPreflight.ps1` and its fixes are gone. The loop checks what it needs itself: `gh`, the base branch (a missing `release/next` is cut), the required checks, the author of each issue and the token source (`--dry-run` shows them).
- **Control session, `--inline`, `--unattended`, `deliver.loopThreshold`.** `/deliver <nr>` delivers one issue and never merges; the loop is `deliver-loop`.
- **Release review, RC test gate and `refine`, `stop`, `-LogPane`, the herdr workspace.** The release pull request is opened without a release review. Run `code-review` on it if you want one.
- **`deliver.roles`, `deliver.sessionTimeoutMinutes`, `deliver.loopThreshold`.** Ignored with one warning line. The loop reads `base`, `tracker`, `harness`, `parallel` and `protectedPaths`.

## What is new

The loop merges the pull request itself once every required check passed, refuses a base without required checks, issues of authors without write access and pull requests that change protected paths, and gives the session a token of its own: see [deliver issues](deliver.md#what-the-loop-refuses).

## Stay on the old loop

Install the skills from the branch: `npx skills add GravionLabs/skills#archive/deliver-v1 --skill deliver`. It receives no fixes.
