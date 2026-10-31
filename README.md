# GravionLabs skills

Agent **skills** for issue-driven delivery and per-stack implementation, in the [agentskills.io](https://agentskills.io) format. One `SKILL.md` loads unchanged on Claude Code, OpenCode and GitHub Copilot; skills are installed with [`npx skills`](https://github.com/vercel-labs/skills). Workflows are skills: `/deliver` chains them from issue to merged PR ([delivery](docs/delivery.md)).

Documentation site: **[gravionlabs.github.io/skills](https://gravionlabs.github.io/skills/)**

Successor of [GravionLabs/apm-hub](https://github.com/GravionLabs/apm-hub) (archived): same skills, installed with `npx skills` instead of APM. Moving over: [after install](skills/delivery/skills-install/references/after-install.md#coming-from-apm-hub).

## Quick start

Requirements: Node.js 22+ (for `npx`), PowerShell 7+ (`pwsh`) for the skill scripts, `gh` for the GitHub and delivery skills. Check them with `check-prerequisites` ([prerequisites](docs/prerequisites.md)).

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

### Where things land

| Platform       | Project                  | Global (`-g`)                |
| :------------- | :----------------------- | :--------------------------- |
| Claude Code    | `.claude/skills/<name>/` | `~/.claude/skills/`          |
| OpenCode       | `.agents/skills/<name>/` | `~/.config/opencode/skills/` |
| GitHub Copilot | `.agents/skills/<name>/` | `~/.copilot/skills/`         |

Commit `skills-lock.json`, `.agents/skills/` and `.claude/skills/` so a fresh clone has the skills. On Windows `skills-install` copies instead of linking (symlinks need Developer Mode).

## Groups

A group is a folder `skills/<group>/` and a plugin in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json); the same file makes this repository a Claude Code plugin marketplace. Installs are flat by skill name.

| Group           | Skills                                                                                                                                                 |
| :-------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared`        | `implementation`, `detect-techstack`, `diagnose`, `code-review`, `check-prerequisites`, `lessons`                                                      |
| `delivery`      | `deliver`, `planner`, `grill-me`, `retro`, `skills-install`                                                                                            |
| `github`        | `github-issue`, `github-pull-request`, `github-release`                                                                                                |
| `dotnet`        | `dotnet-implementation`, `dotnet-test`, `dotnet-create-solution`, `dotnet-mcp-server-generator`; `skills-install` adds `dotnet/skills` (dotnet plugin) |
| `ts`            | `ts-implementation`, `ts-test`, `ts-create-project`, `ts-mcp-server-generator`, `ts-pnpm-workflow`, `setup-biome-husky`, `setup-prettier-eslint-husky` |
| `py`            | `py-implementation`, `py-test`, `py-create-project`                                                                                                    |
| `rust`          | `rust-implementation`, `rust-test`                                                                                                                     |
| `go`            | `go-implementation`, `go-test`                                                                                                                         |
| `ng`            | `ng-implementation`, `ng-test`, `ng-create-project`, `ng-ag-grid-developer`; `skills-install` adds `angular/skills` (`angular-developer`)              |
| `statusline`    | `context-statusline`: status line and subagent status line                                                                                             |
| `skill-tooling` | `skill-write`, `skill-audit`, `skill-slim` (contributor tooling)                                                                                       |

Presets of `skills-install`: `core` (`shared`, `github`, `delivery`, `statusline`) and `all` (every group except `skill-tooling`).

📄 **[Skills](docs/concepts/skills.md)** · 📄 **[Skill list](docs/skill-list.md)** (generated) · 📄 **[Working mode](docs/working-mode.md)** · 📄 **[Delivery](docs/delivery.md)** · 📄 **[Project config](docs/usage/project-config.md)** · 📄 **[External frameworks](docs/frameworks.md)** · 📄 **[AGENTS.md](AGENTS.md)** for layout and conventions

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before adding or changing a skill.

```bash
pnpm install
pnpm run check                                        # everything CI runs
node scripts/check-marketplace.mjs --fix                 # after adding skills/<group>/<name>/
```

New or changed skills follow the [skill frontmatter convention](docs/concepts/skill-frontmatter.md).
