# Quick start

Install the skills, check where they landed, and run a first prompt.

Requirements: Node.js 22+ (for `npx`), PowerShell 7+ (`pwsh`) for the skill scripts, `gh` for the GitHub and delivery skills. Check them with `check-prerequisites` ([prerequisites](prerequisites.md)).

## Install

1. Install the installer skill once per machine:

   ```bash
   npx skills add GravionLabs/skills --skill skills-install -g -y
   ```

2. In your agent, let it detect the stack and propose the groups (dry run first, it asks before installing):

   ```text
   /skills-install              # this project: detects ts, py, dotnet, rust, go, angular
   /skills-install core -g      # user-wide: shared, github, delivery, statusline
   ```

   Without the agent: `pwsh ~/.claude/skills/skills-install/scripts/Install-Skills.ps1 -DryRun`.

3. Or install single skills directly:

   ```bash
   npx skills add GravionLabs/skills --list                                  # what is there
   npx skills add GravionLabs/skills --skill deliver --skill planner -a claude-code -a opencode
   npx skills add GravionLabs/skills#v1.0.0 --skill ts-implementation          # pinned to a release
   ```

Updates: `npx skills check` (exit 1 when one is available) and `npx skills update`. The skills CLI sends anonymous telemetry; `DISABLE_TELEMETRY=1` turns it off.

## Where things land

| Platform       | Project                  | Global (`-g`)                |
| :------------- | :----------------------- | :--------------------------- |
| Claude Code    | `.claude/skills/<name>/` | `~/.claude/skills/`          |
| OpenCode       | `.agents/skills/<name>/` | `~/.config/opencode/skills/` |
| GitHub Copilot | `.agents/skills/<name>/` | `~/.copilot/skills/`         |

Commit `skills-lock.json`, `.agents/skills/` and `.claude/skills/` so a fresh clone has the skills. On Windows `skills-install` copies instead of linking (symlinks need Developer Mode).

## First prompts

```text
Plan issue #42.
/deliver 42
```

`Plan issue #42.` makes `planner` split the issue one level down; `/deliver 42` implements, reviews and merges the open PBIs of issue 42 ([delivery](delivery.md)). More examples: [stack setups](guides/stack-setups.md).
