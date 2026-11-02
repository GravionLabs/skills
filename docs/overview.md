# Overview

GravionLabs/skills is a library of reusable **skills** in the [agentskills.io](https://agentskills.io) `SKILL.md` format, installed with [`npx skills`](https://github.com/vercel-labs/skills). One skill source loads unchanged on **Claude Code**, **OpenCode** and **GitHub Copilot**. Workflows are skills. The skill `deliver` chains them from issue to merged PR, see [delivery](delivery.md).

This documentation is also published as a site at <https://gravionlabs.github.io/skills/>.

## What a group gives you

A group is a set of skills for one domain, listed in `.claude-plugin/marketplace.json`. Installing it copies (or links) the skills into your repository, where the agent picks them up by their `description` or when you name them. `/skills-install` resolves the groups for a project; `npx skills add GravionLabs/skills --skill <name>` installs single skills.

| Group           | What it covers                                                                                                                                                                                                                                                                       |
| :-------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared`        | `implementation` (tests per change), `detect-techstack`, `code-review` (blocking findings and notes), `diagnose` (bug diagnosis), `check-prerequisites`, `lessons` (approved project lessons per role), `adr` (ADR with the next free number, see [governance](usage/governance.md)) |
| `delivery`      | `deliver`, `planner`, `grill-me`, `retro`, `skills-install`                                                                                                                                                                                                                          |
| `github`        | `github-issue` (Epic → Feature → PBI hierarchy with native sub-issues), `github-pull-request`, `github-release`, `github-milestone` (current and all milestones with their progress)                                                                                                 |
| `dotnet`        | `dotnet-implementation`, `dotnet-test`, `dotnet-create-solution`, `dotnet-mcp-server-generator`, `dotnet-aspire` (AppHost for local orchestration)                                                                                                                                   |
| `ts`            | `ts-implementation`, `ts-test`, `ts-create-project`, `ts-mcp-server-generator`, `ts-pnpm-workflow`, `setup-biome-husky`, `setup-prettier-eslint-husky`                                                                                                                               |
| `py`            | `py-implementation`, `py-test`, `py-create-project`                                                                                                                                                                                                                                  |
| `rust`          | `rust-implementation`, `rust-test`                                                                                                                                                                                                                                                   |
| `go`            | `go-implementation`, `go-test`                                                                                                                                                                                                                                                       |
| `ng`            | `ng-implementation`, `ng-test`, `ng-create-project`, `ng-ag-grid-developer`                                                                                                                                                                                                          |
| `statusline`    | `context-statusline`: status line and subagent status line                                                                                                                                                                                                                           |
| `skill-tooling` | `skill-write`, `skill-audit`, `skill-slim` (contributor tooling, not in the `all` preset)                                                                                                                                                                                            |

Presets of `/skills-install`: `core` (`shared`, `github`, `delivery`, `statusline`, for the global install) and `all` (every group except `skill-tooling`). The full list with descriptions is generated into [skill-list.md](skill-list.md).

## How the skills fit together

`detect-techstack` names the language skills, `implementation` and `code-review` dispatch to them, and `planner` and `deliver` sit on top; `github-issue` is the entry point for issue work. The diagram is on [skill composition](concepts/composition.md), the issue hierarchy and labels on the [issue model](concepts/issue-model.md).

Skills delegate by name instead of repeating each other. One skill owns a workflow; the others call it.

## Where to go next

- [Quick start](quick-start.md): install the skills and run a first prompt
- [Skills](concepts/skills.md): how skills load on each platform and how they are structured
- [Skill composition](concepts/composition.md) and [issue model](concepts/issue-model.md): how the skills call each other, and the Epic, Feature, PBI and Bug hierarchy with its labels
- [Skill frontmatter convention](concepts/skill-frontmatter.md): the restricted frontmatter that keeps skills portable
- [Stack setups](guides/stack-setups.md), [work an issue by hand](guides/work-an-issue-by-hand.md) and [fix a bug](guides/fix-a-bug.md): end-to-end examples with the installed skills
- [Learn from runs](guides/learn-from-runs.md): `retro`, lessons and the flow diagram
- [ADRs and specs](usage/governance.md): how the `governance` key ties `adr`, `planner`, `implementation`, `code-review`, `deliver` and CI together
- [Skill companion directories](usage/skill-companion-dirs.md): `scripts/`, `references/`, `templates/`, `assets/`
- [Plan an issue](guides/plan-an-issue.md), [work an issue by hand](guides/work-an-issue-by-hand.md) and [delivery](delivery.md): one issue per session, and delivery through `/deliver`
- [herdr with the skills](guides/herdr.md): pane tokens, sidebar layout and the herdr plugins for `/deliver`
- [Prerequisites](prerequisites.md): tools the skill scripts depend on
- [LSP configuration](lsp-configuration.md): language servers for Copilot CLI
- [CONTRIBUTING.md](../CONTRIBUTING.md) and [AGENTS.md](../AGENTS.md): adding or changing skills

## Guiding principles

- One `SKILL.md` ≤ 100 lines; long material lives in `references/`, procedures in `scripts/`.
- Rules the model does not already know: repo conventions, tool contracts, repeatable procedures. No generic tutorials.
- Compose, don't duplicate.
- The agent proposes, the developer approves.
