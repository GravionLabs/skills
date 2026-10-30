# Skills

A **skill** is a directory with a `SKILL.md` file and optional companion files (`scripts/`, `references/`, `templates/`, `assets/`). It packages a procedure, a convention or a tool contract so an AI coding agent can load it on demand. Skills follow the open [Agent Skills specification](https://agentskills.io/specification) and are the main artifact apm-hub ships; the separate `agents` package adds a few agents that skills cannot replace.

## How a skill is loaded

Agents load skills progressively:

| Stage      | What loads                                          | When                                                          |
| :--------- | :-------------------------------------------------- | :------------------------------------------------------------ |
| Discovery  | `name` and `description` of every installed skill   | Session start                                                 |
| Activation | The full `SKILL.md` body                            | The description matches the task, or the user names the skill |
| Execution  | Files under `references/`, `scripts/`, `templates/` | Only when the skill says to read or run them                  |

This is why the `description` is trigger-oriented (what the skill does **and** when to use it) and why `SKILL.md` stays short: everything in it costs tokens on every activation.

You can always name a skill explicitly:

```text
Use the dotnet-create-solution skill to scaffold the project.
```

## Where skills live

Skills are authored once under `skills/<group>/<name>/` and installed (flat, by name) by `npx skills add` into each platform's directory:

| Platform       | Project path              | Global path                    |
| :------------- | :------------------------ | :----------------------------- |
| Claude Code    | `.claude/skills/<name>/`  | `~/.claude/skills/<name>/`     |
| OpenCode       | `.agents/skills/<name>/`  | `~/.config/opencode/skills/`   |
| GitHub Copilot | `.agents/skills/<name>/`  | `~/.copilot/skills/`           |

`.agents/skills/` holds the canonical copy; `.claude/skills/` links to it (copies on Windows). Commit both and `skills-lock.json` so a fresh clone has the skills immediately.

## Structure of a SKILL.md

```markdown
---
name: ts-test
description: >
  TypeScript/Node.js test rules using Vitest. Covers runner config, file naming,
  mocking, coverage and test-writing methodology. Use when writing or running
  tests in a TypeScript project.
---

One-line purpose. Paths to `scripts/` and `references/` are relative to this skill's directory.

## Steps
...

## Gotchas
...
```

Rules that every skill in this repo follows:

- Frontmatter has only `name`, `description` and optional `license` / `metadata`. See the [frontmatter convention](skill-frontmatter.md) for why `allowed-tools`, `model` and similar keys are rejected.
- `SKILL.md` is at most 100 lines (enforced by a test). Long specs go to `references/` with a conditional load line, repeatable procedures to `scripts/*.ps1`, starter files to `templates/`.
- Scripts are PowerShell 7+ and are called as `pwsh scripts/<Name>.ps1`.
- A skill that needs another skill's work delegates by name instead of restating it.

The complete rule set is in `skills/skill-tooling/skill-write/references/skill-writing-rules.md`; the `skill-write`, `skill-audit` and `skill-slim` skills apply it.

## How the skills compose

- `detect-techstack` returns a JSON report naming the `<lang>-implementation` and `<lang>-test` skills for the project.
- `implementation` enforces "every change has tests" and dispatches to the language skill from that report.
- `code-review` reads the `## Review rules` section of each detected `<lang>-implementation` skill and reports blocking findings and notes.
- `diagnose` is loaded for bug fixes: it builds a red-capable feedback loop (commands from `<lang>-test`) before any hypothesis.
- `planner` plans an issue one level down; `/deliver` ([delivery](../delivery.md)) chains the skills PBI by PBI, interactive or `--unattended`.
- `github-issue` routes issue work by label and sub-issue shape; `github-pull-request` opens the PR.

## Slash commands

A skill with `disable-model-invocation: true` is started by name only (`/deliver`, `/skills-install`); the behaviour lives in the skill, so it works the same on every platform.

## Related

- [Skill frontmatter convention](skill-frontmatter.md)
- [Skill companion directories](../usage/skill-companion-dirs.md)
- [Common workflows](../usage/common-workflows.md)
- [All skills](../skill-list.md) (generated)
- [agentskills.io specification](https://agentskills.io/specification)
- [GitHub Copilot: about agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills)
