# Skill Frontmatter Convention

Every `SKILL.md` in `skills/<group>/<name>/` must carry only the frontmatter defined here.
The goal: one source file that loads cleanly on **GitHub Copilot**, **Claude Code**, and **OpenCode**
without per-platform rewriting. The convention follows the
[agentskills.io specification](https://agentskills.io/specification).

## Legal top-level keys

| Key           | Required | Rules                                                                                   |
| :------------ | :------- | :-------------------------------------------------------------------------------------- |
| `name`        | yes      | kebab-case, matches the skill directory name                                            |
| `description` | yes      | Trigger-oriented: what the skill does **and** when to use it, including trigger phrases |
| `license`     | no       | SPDX identifier (e.g. `MIT`)                                                            |
| `metadata`    | no       | Map for everything non-standard (see below)                                             |

## Optional client keys

A few keys change *how* a host loads a skill without changing what the skill says. They are
extensions in the sense of the agentskills.io spec: hosts that do not know them ignore them.
These, and only these, may appear in addition to the keys above:

| Key                        | Honored by                                   | Effect                                                                                                            |
| :------------------------- | :------------------------------------------- | :---------------------------------------------------------------------------------------------------------------- |
| `disable-model-invocation` | Claude Code, VS Code Copilot                 | `true` removes the description from the model's skill list; the skill runs only when the user types `/<name>`.    |
| `user-invocable`           | Claude Code, VS Code Copilot                 | `false` hides the skill from the `/` menu; the model may still load it. Written only as `false`; `true` is the default.                                   |
| `context`                  | Claude Code, VS Code Copilot (experimental)  | `fork` runs the skill in a subagent with its own context; only the result returns to the caller.                  |
| `agent`                    | Claude Code                                  | With `context: fork`: the agent definition to run in (`explorer`, `reviewer`, or a built-in such as `Explore`).   |

Rules:

- `disable-model-invocation: true` is always paired with `metadata: { opencode/autoinvoke: "false" }`,
  the OpenCode equivalent. Copilot CLI ignores both (support unverified); the skill still loads via `/<name>`.
- Gate a skill only when it creates a project or sets up tooling once (`*-create-project`, the MCP
  server generators, `setup-prettier-eslint-husky`, `ts-pnpm-workflow`). Never gate
  what is used during an implementation or at the end of a feature: `github-release` is part of the
  issue chain (`cut` before the first PBI, `finish` after the last), and a reference the model needs
  mid-task belongs in `references/` of its parent skill instead of a gated skill. Skills that other
  skills load by name (`<lang>-implementation`, `<lang>-test`, `detect-techstack`) stay model-invocable.
- A forked skill states its return contract in the body (for example "JSON only, no logs"), because the
  forked result is all the caller sees. Do not fork skills that spawn subagents themselves or need to ask the user.
- Why these keys matter: every listed description is sent with every request. In a 30-day sample the
  descriptions of never-used skills cost more tokens than all loaded skill bodies together.

**No other top-level keys are allowed.** In particular:

- **`allowed-tools` — dropped.** All three platforms run skills fine without it. The old values
  (`execute shell runCommands read write edit editFiles search codebase`) mixed Copilot and generic
  tool names in one space-separated string; Claude Code parses `allowed-tools` as a comma-separated
  list of *its* tool names, so the field matched nothing anywhere. Tool restriction is the host
  platform's job (agent `permission` blocks, Claude Code settings, Copilot policies), not the
  skill's. Decision recorded 2026-07 in #43.
- **`model` — forbidden.** Model choice is platform-specific and goes stale (`gpt-4.1` meant
  nothing to Claude Code or OpenCode). Skills are instructions, not runtime configuration.
- **`compatibility` — dropped.** Every skill claimed `opencode, github-copilot` while also working
  on Claude Code; a field that is uniformly wrong carries no information. Spec-compliant skills are
  compatible with all agentskills.io hosts by definition. If a skill ever genuinely supports only
  one platform, record that under `metadata.compatibility` with a comment explaining why.
- **`chronicle-hints`** and any other custom annotations move under `metadata:`.

## Template

```yaml
---
name: my-skill
description: >
  Does X for Y. Use this skill when the user asks to "do X", "set up Y",
  even if the request is underspecified.
license: MIT
metadata:
  chronicle-hints: 'single-purpose, structured-output, phases'
---
```

`metadata` values are free-form strings; hosts ignore them. Authorship/attribution
(e.g. upstream copyright) also lives here.

A user-only skill (see *Optional client keys*):

```yaml
---
name: ng-create-project
description: Scaffold a new Angular workspace. Use when asked to create or start an Angular project.
disable-model-invocation: true
metadata:
  opencode/autoinvoke: 'false'
---
```

A forked skill:

```yaml
---
name: github-pull-request
description: Create a GitHub PR from the current branch and linked issue via gh.
context: fork
---
```

## Verified behavior of `context: fork` (Claude Code, measured 2026-10-12)

- `agent:` is honored: `/detect-techstack` with `agent: explorer` ran as a subagent of type `explorer`
  (model haiku); with `agent: reviewer` as type `reviewer`.
- The fork starts with a fresh context (about 6k tokens for the agent prompt plus the skill text),
  not with the session history; only its final message returns to the caller.
- The fork has the tool set of the agent: `explorer` has no shell, so it could not run
  `Detect-TechStack.ps1` and fell back to eight glob calls through `node_modules`; `reviewer` ran the
  script in four turns. A forked skill that must run commands needs an agent with Bash.
- Without `agent:` the fork uses the general-purpose agent with the caller's model.
- Skills that run at the end of a long session and read everything from `git` and `gh`
  (`github-pull-request`, `github-release`) are forked so they do not pay for the session history.

## Body rules (unchanged)

- Keep `SKILL.md` under ~100 lines; push detail into `references/*.md` (progressive disclosure).
- Reference files are loaded on demand by the skill body — never rely on frontmatter to load them.

## Enforcement

- `skill-write` (group `skill-tooling`) scaffolds this template.
- `skill-audit` flags any non-standard top-level key (`allowed-tools`, `model`, `compatibility`,
  `chronicle-hints`, …) as a violation; the optional client keys above are not violations, but
  `disable-model-invocation` without the OpenCode `metadata` pair is.
