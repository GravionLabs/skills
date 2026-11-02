# GravionLabs skills

Agent **skills** for issue-driven delivery and per-stack implementation, in the [agentskills.io](https://agentskills.io) format. One `SKILL.md` loads unchanged on Claude Code, OpenCode and GitHub Copilot; skills are installed with [`npx skills`](https://github.com/vercel-labs/skills). Workflows are skills: `/deliver` chains them from issue to merged PR ([delivery](docs/delivery.md)).

Documentation site: **[gravionlabs.github.io/skills](https://gravionlabs.github.io/skills/)**

Successor of [GravionLabs/apm-hub](https://github.com/GravionLabs/apm-hub) (archived): same skills, installed with `npx skills` instead of APM. Moving over: [after install](skills/delivery/skills-install/references/after-install.md#coming-from-apm-hub).

## Quick start

Install the installer skill once per machine, then let your agent pick the groups:

```bash
npx skills add GravionLabs/skills --skill skills-install -g -y
```

Requirements, the other install options, updates and where the skills land: [quick start on the documentation site](https://gravionlabs.github.io/skills/quick-start).

## Groups

A group is a folder `skills/<group>/` and a plugin in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json); the same file makes this repository a Claude Code plugin marketplace. Installs are flat by skill name.

| Group           | Skills                                                                                                                                                                                                    |
| :-------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared`        | `implementation`, `detect-techstack`, `diagnose`, `code-review`, `check-prerequisites`, `lessons`, `adr`                                                                                                  |
| `delivery`      | `deliver`, `planner`, `grill-me`, `retro`, `skills-install`                                                                                                                                               |
| `github`        | `github-issue`, `github-pull-request`, `github-release`, `github-milestone`                                                                                                                               |
| `dotnet`        | `dotnet-implementation`, `dotnet-test`, `dotnet-create-solution`, `dotnet-mcp-server-generator`, `dotnet-aspire` (AppHost for local orchestration); `skills-install` adds `dotnet/skills` (dotnet plugin) |
| `ts`            | `ts-implementation`, `ts-test`, `ts-create-project`, `ts-mcp-server-generator`, `ts-pnpm-workflow`, `setup-biome-husky`, `setup-prettier-eslint-husky`                                                    |
| `py`            | `py-implementation`, `py-test`, `py-create-project`                                                                                                                                                       |
| `rust`          | `rust-implementation`, `rust-test`                                                                                                                                                                        |
| `go`            | `go-implementation`, `go-test`                                                                                                                                                                            |
| `ng`            | `ng-implementation`, `ng-test`, `ng-create-project`, `ng-ag-grid-developer`; `skills-install` adds `angular/skills` (`angular-developer`)                                                                 |
| `statusline`    | `context-statusline`: status line, subagent line, warning hook                                                                                                                                            |
| `skill-tooling` | `skill-write`, `skill-audit`, `skill-slim` (contributor tooling)                                                                                                                                          |

Presets of `skills-install`: `core` (`shared`, `github`, `delivery`, `statusline`) and `all` (every group except `skill-tooling`).

📄 **[Skills](docs/concepts/skills.md)** · 📄 **[Skill list](docs/skill-list.md)** (generated) · 📄 **[Work an issue by hand](docs/guides/work-an-issue-by-hand.md)** · 📄 **[Delivery](docs/delivery.md)** · 📄 **[Project config](docs/usage/project-config.md)** · 📄 **[External frameworks](docs/frameworks.md)** · 📄 **[AGENTS.md](AGENTS.md)** for layout and conventions

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before adding or changing a skill.

```bash
pnpm install
pnpm run check                                        # everything CI runs
node scripts/check-marketplace.mjs --fix                 # after adding skills/<group>/<name>/
```

New or changed skills follow the [skill frontmatter convention](docs/concepts/skill-frontmatter.md).
