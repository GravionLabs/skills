# /deliver

## Usage

```
/deliver <nr> [<nr> …] [--milestone <name>] [--unattended] [--max <n>]
/deliver help
```

Delivers the open PBIs and Bugs of the given issues in dependency order: a subagent implements (`implementation`), a subagent reviews (`code-review`, at most 2 fix rounds), then PR into `release/next`, required checks, squash merge, close. State lives in GitHub only; run it again to continue.

## Arguments and flags

- `<nr> [<nr> …]`: PBI, Bug, Feature or Epic numbers; each open PBI or Bug below them is delivered once. Missing: asked once.
- `--milestone <name>`: adds the open PBIs and Bugs of that milestone. When all are delivered, `github-release finish` opens the release PR into `main` after a release review; it is never merged by `deliver`.
- `--unattended`: never asks. A pause comments on the issue, adds `needs-decision` and goes on with the next independent PBI. Interactive (default): a pause or a blocked PBI asks in the chat (retry, skip or an instruction).
- `--max <n>`: stops after `n` delivered, blocked or paused PBIs and prints the report.
- Skipped: `needs-decision`; `needs-refinement` (hint `planner refine <nr>`); `interactive` (unattended only; `/deliver <nr>` in a session delivers it); PBIs claimed by another session.
- `help`, `--help`, `-h`: print this file.

### Loop script

One fresh `claude -p "/deliver … --unattended --max 1"` (`copilot -p …` with `-Harness copilot`) per PBI:

```powershell
pwsh scripts/Invoke-DeliverLoop.ps1 -Target 12,14 -Milestone 1.3.0 -Max 5 -Model sonnet
pwsh scripts/Invoke-DeliverLoop.ps1 -Milestone 1.3.0 -Harness copilot -Model gpt-5
```

- `-Target <nr…>`: issue numbers, as `<nr>` above
- `-Milestone <name>`: as `--milestone`
- `-Max <n>`: stop after `n` iterations
- `-Model <name>`: model of the orchestrating session (default `sonnet`)
- Shell command `deliver-loop` (offered by `skills-install`) runs the installed script from any directory with the same flags, e.g. `deliver-loop -Milestone 1.3.0 -Max 5`. In herdr it opens the workspace `<repo> · deliver` (tab `deliver-loop`).
- Also `-LogPane` (opens the herdr log pane; off by default, `-NoPane` is a deprecated no-op) and `-NoColor` (no `.ansi.log`, plain stdout). Stdout is colored on a terminal. Exit 0 done or max reached, 1 no progress, 2 blocked, 64 bad arguments.

## Examples

```
/deliver 42
/deliver 7 9 11
/deliver --milestone 1.3.0
/deliver 7 --unattended --max 3
```

## Config

`.agents/config.json`:

- `deliver.roles`: model and effort per subagent role (`implement`, `review`, `fix`, `release-review`; `tiers` for `implement` and `fix`); see `references/roles.md`.
- `governance`: switches on decision PBIs and spec notes; see `references/governance.md`.

## See also

- `references/loop.md`, `references/claim.md`, `references/release-review.md`, `references/permissions.md`
- `planner` (refine, plan), `github-milestone`, `github-release`
