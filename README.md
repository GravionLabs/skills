# GravionLabs skills

Agent **skills** for issue-driven delivery and per-stack implementation, in the [agentskills.io](https://agentskills.io) format. One `SKILL.md` loads unchanged on Claude Code, OpenCode and GitHub Copilot; skills are installed with [`npx skills`](https://github.com/vercel-labs/skills). Workflows are skills: `/deliver` chains them from issue to merged PR ([delivery](site/delivery.md)).

Documentation site: **[gravionlabs.github.io/skills](https://gravionlabs.github.io/skills/)**

Successor of [GravionLabs/apm-hub](https://github.com/GravionLabs/apm-hub) (archived): same skills, installed with `npx skills` instead of APM. Moving over: [after install](skills/delivery/skills-manage/references/after-install.md#coming-from-apm-hub).

## Quick start

Install the installer skill once per machine, then let your agent pick the groups:

```bash
npx skills add GravionLabs/skills --skill skills-manage -g -y
```

Requirements, the other install options, updates and where the skills land: [quick start on the documentation site](https://gravionlabs.github.io/skills/quick-start).

## Groups

A group is a folder `skills/<group>/` and a plugin in [`.claude-plugin/marketplace.json`](.claude-plugin/marketplace.json); the same file makes this repository a Claude Code plugin marketplace. Installs are flat by skill name.

| Group           | Skills                                                                                                                                                                                                                                                                                                                                                                                     |
| :-------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shared`        | `implementation`, `detect-techstack`, `diagnose`, `code-review`, `check-prerequisites`, `lessons`, `adr`, `project-setup`                                                                                                                                                                                                                                                                  |
| `delivery`      | `deliver` (interactive milestone runs as a control session over the loop, `--inline`; loop: `-Harness claude` or `-Harness copilot`, `deliver-loop`shim via`Install-LoopShim.ps1`, `Start-LoopWorkspace.ps1`, colored stdout, `-LogPane`, herdr agent state), `planner`, `grill-me`, `retro`, `roadmap`, `skills-manage` (install and `update`)                                            |
| `github`        | `github-issue`, `github-pull-request`, `github-release`, `github-milestone` (milestones `M<nnn>`, renamed `M<nnn> (x.y.z)` on close: list, show, current, create (also sub-numbers `M001.1`), `insert M<nnn>`, `assign M<nnn> or none #n …`, `renumber [--dry-run] [--all-repos]`, `close <name> [--move-to <name>]`), `github-project`(GitHub Project v2 standard:`apply`, `sync`, `new`) |
| `dotnet`        | `dotnet-implementation`, `dotnet-test`, `dotnet-create-solution`, `dotnet-mcp-server-generator`, `dotnet-aspire` (AppHost for local orchestration); `skills-manage` adds `dotnet/skills` (dotnet plugin)                                                                                                                                                                                   |
| `ts`            | `ts-implementation`, `ts-test`, `ts-create-project`, `ts-mcp-server-generator`, `ts-pnpm-workflow`, `setup-biome-husky`, `setup-prettier-eslint-husky`                                                                                                                                                                                                                                     |
| `py`            | `py-implementation`, `py-test`, `py-create-project`                                                                                                                                                                                                                                                                                                                                        |
| `rust`          | `rust-implementation`, `rust-test`                                                                                                                                                                                                                                                                                                                                                         |
| `go`            | `go-implementation`, `go-test`                                                                                                                                                                                                                                                                                                                                                             |
| `ng`            | `ng-implementation`, `ng-test`, `ng-create-project`, `ng-ag-grid`; `skills-manage` adds `angular/skills` (`angular-developer`)                                                                                                                                                                                                                                                             |
| `statusline`    | `context-statusline`: status line, subagent line, warning hook                                                                                                                                                                                                                                                                                                                             |
| `skill-tooling` | `skill-write`, `skill-audit`, `skill-slim` (contributor tooling)                                                                                                                                                                                                                                                                                                                           |

Presets of `skills-manage`: `core` (`shared`, `github`, `delivery`, `statusline`) and `all` (every group except `skill-tooling`).

📄 **[Skills](site/concepts/skills.md)** · 📄 **[Skill list](site/skill-list.md)** (generated) · 📄 **[Work an issue by hand](site/guides/work-an-issue-by-hand.md)** · 📄 **[Delivery](site/delivery.md)** · 📄 **[Project config](site/usage/project-config.md)** · 📄 **[External frameworks](site/frameworks.md)** · 📄 **[AGENTS.md](AGENTS.md)** for layout and conventions

## Contributing

Read [CONTRIBUTING.md](CONTRIBUTING.md) before adding or changing a skill.

```bash
pnpm install
pnpm run check                                        # everything CI runs
node scripts/check-marketplace.mjs --fix                 # after adding skills/<group>/<name>/
```

New or changed skills follow the [skill frontmatter convention](site/concepts/skill-frontmatter.md).
