# Overview

GravionLabs/skills is a library of reusable **skills** in the [agentskills.io](https://agentskills.io) `SKILL.md` format, installed with [`npx skills`](https://github.com/vercel-labs/skills). One skill source loads unchanged on **Claude Code**, **OpenCode** and **GitHub Copilot**. Workflows are skills. The skill `deliver` chains them from issue to merged PR, see [delivery](delivery.md).

This documentation is also published as a site at <https://gravionlabs.github.io/skills/>.

## What a group gives you

A group is a set of skills for one domain, listed in `.claude-plugin/marketplace.json`. Installing it copies (or links) the skills into your repository, where the agent picks them up by their `description` or when you name them. `/skills-install` resolves the groups for a project; `npx skills add GravionLabs/skills --skill <name>` installs single skills.

| Group           | What it covers                                                                                                                                          |
| :-------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `shared`        | `implementation` (tests per change), `detect-techstack`, `code-review` (blocking findings and notes), `diagnose` (bug diagnosis), `check-prerequisites` |
| `delivery`      | `deliver`, `planner`, `grill-me`, `retro`, `skills-install`                                                                                             |
| `github`        | `github-issue` (Epic → Feature → PBI → Task hierarchy with native sub-issues), `github-pull-request`, `github-release`                                  |
| `dotnet`        | `dotnet-implementation`, `dotnet-test`, `dotnet-create-solution`, `dotnet-mcp-server-generator`                                                         |
| `ts`            | `ts-implementation`, `ts-test`, `ts-create-project`, `ts-mcp-server-generator`, `ts-pnpm-workflow`, `setup-biome-husky`, `setup-prettier-eslint-husky`  |
| `py`            | `py-implementation`, `py-test`, `py-create-project`                                                                                                     |
| `rust`          | `rust-implementation`, `rust-test`                                                                                                                      |
| `go`            | `go-implementation`, `go-test`                                                                                                                          |
| `ng`            | `ng-implementation`, `ng-test`, `ng-create-project`, `ng-ag-grid-developer`                                                                             |
| `statusline`    | `context-statusline`: status line and subagent status line                                                                                              |
| `skill-tooling` | `skill-write`, `skill-audit`, `skill-slim` (contributor tooling, not in the `all` preset)                                                               |

Presets of `/skills-install`: `core` (`shared`, `github`, `delivery`, `statusline`, for the global install) and `all` (every group except `skill-tooling`). The full list with descriptions is generated into [skill-list.md](skill-list.md).

## How the skills fit together

- Every language group has a `<lang>-implementation` skill (conventions plus a `## Review rules` section) and a `<lang>-test` skill.
- `detect-techstack` inspects the project and returns the names of those skills, so `implementation` and `code-review` dispatch to the right language without hard-coded lists.
- You compose the rest in one session: plan with `planner`, implement with `implementation`, review with `code-review`, open the PR with `github-pull-request`.
- `github-issue` is the entry point for issue work. It reads the issue labels and sub-issues and routes to the matching reference workflow.

Skills delegate by name instead of repeating each other. One skill owns a workflow; the others call it.

## Where to go next

- [Quick start and installation](../README.md#quick-start)
- [Skills](concepts/skills.md): how skills load on each platform and how they are structured
- [Skill frontmatter convention](concepts/skill-frontmatter.md): the restricted frontmatter that keeps skills portable
- [Common workflows](usage/common-workflows.md): end-to-end examples with the installed skills
- [Skill companion directories](usage/skill-companion-dirs.md): `scripts/`, `references/`, `templates/`, `assets/`
- [Working mode](working-mode.md) and [delivery](delivery.md): one issue per session, and delivery through `/deliver`
- [Prerequisites](prerequisites.md): tools the skill scripts depend on
- [LSP configuration](lsp-configuration.md): language servers for Copilot CLI
- [CONTRIBUTING.md](../CONTRIBUTING.md) and [AGENTS.md](../AGENTS.md): adding or changing skills

## Guiding principles

- One `SKILL.md` ≤ 100 lines; long material lives in `references/`, procedures in `scripts/`.
- Rules the model does not already know: repo conventions, tool contracts, repeatable procedures. No generic tutorials.
- Compose, don't duplicate.
- The agent proposes, the developer approves.
