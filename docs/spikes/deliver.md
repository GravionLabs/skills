# Spike: workflow, skill and harness capabilities for `deliver`

> Spike from GravionLabs/apm-hub (#823, 2026-10-28), kept as history. It names the apm install paths, dromos and keryx of that time; keryx is archived and installs now run through `npx skills`.

Issue: #823 (Feature #822, Epic #821). Date: 2026-10-28. Claude Code 2.1.312, OpenCode 1.19.5 (`npx opencode-ai@1.19.5`).

Every Claude Code answer comes from a run of a probe workflow with two subagents: one loads the skill `detect-techstack`, one runs three shell commands (`git status --short | head -3`, `pnpm --version`, `f=$(mktemp) && rm "$f" && echo removed`). The probe skill was a `SKILL.md` plus `workflow.js` in a skill folder; it is removed again.

| # | Question | Answer |
|---|---|---|
| 1 | Workflow subagents load skills reliably | **yes** |
| 2 | Subagents run without prompts on the project allowlist alone | **yes**, if every command is on it |
| 3 | `scriptPath` on a file inside an installed skill | **project: yes; `~/.claude/skills`: no** |
| 4 | `claude -p "/deliver <nr>"` runs a workflow headless | **yes** |
| 5 | Workflow subagents write metadata agentlens can read as the role | **partly**: label yes, other path |
| 6 | OpenCode loads the apm-hub `SKILL.md` skills | **yes** |
| 7 | OpenCode loads a plugin from npm and can deny a shell call | **yes by the docs; not run** |
| 8 | OpenCode events for session started, idle, waiting | **yes** |

## 1. Skills in workflow subagents

The Skill tool is available to a workflow subagent, and `detect-techstack` loaded in the interactive run and in the headless run.

Check: an `agent()` whose prompt says "Use the Skill tool to load the skill `<name>`" with a schema `{ skillToolAvailable, loaded, firstHeading }`.

## 2. Permissions

Workflow subagents inherit the session's permission mode and allowlist.

- Interactive session in auto mode: all three commands ran.
- Headless, `--permission-mode default --allowedTools Workflow Skill Read`: `git status` ran (read-only), `pnpm --version` needed approval and did not run, the `mktemp` command was denied ("Quoted text in this command can't be checked before it runs").
- The same with `Bash(pnpm --version)` added to `--allowedTools`: `pnpm --version` ran. The quoted command was still denied.

Consequences for `deliver`:

- The verify, format and `gh` commands of a repository must be on the project allowlist (`.claude/settings.json`), or the run uses auto mode. In an interactive session a missing entry becomes a prompt that stops an unattended run.
- Prompts of the role skills must avoid shell constructs the permission check cannot see through (quoted substitutions, `$(…)` with quotes). Simple commands only.

## 3. Workflow script inside a skill folder

The Workflow tool only accepts a `scriptPath` that the session can read: the working directory or an added directory. A script in the project's `.claude/skills/<skill>/` worked. A script in `~/.claude/skills/<skill>/` was refused, even after reading it with the Read tool:

```
scriptPath must be a script path this tool returned, or a file you can already read
(the working directory or a directory you have added)
```

When a skill loads, Claude Code prints its base directory, so the skill can name the absolute path of its script.

Consequences for `deliver`:

- Installed per project (`apm install` into the repository), `deliver/workflow.js` next to `SKILL.md` works as planned.
- A global install (`apm install -g`) needs one of three fallbacks: `~/.claude/skills` as an added directory (`permissions.additionalDirectories` in the user settings), the skill passing the script inline (the skill reads `workflow.js` and passes its text as `script`), or `.claude/workflows/`. Inline needs no setup and is the default fallback; #826 decides.

## 4. Headless

`claude -p "/spike-deliver" --permission-mode default --allowedTools Workflow Skill Read --output-format json` ran the skill, the workflow and both subagents, and returned the workflow result. `Workflow` must be in `--allowedTools`.

Cost: $1.05 for this probe (2 trivial subagents), $0.68 for the run with one subagent. Everything ran on the session's default model (here `claude-fable-5-1`), including the subagents: about 30 k cached context tokens per subagent before it does anything. `deliver` must set `model` and `effort` per `agent()` call (`sonnet` or `haiku` for implement, gate and PR), or a run of many PBIs gets expensive.

## 5. Metadata of workflow subagents

Workflow subagents write their transcripts to `<project>/<session>/subagents/workflows/<runId>/agent-<id>.jsonl` with a `.meta.json`:

```json
{"agentType":"workflow-subagent","isBuiltIn":true,"description":"skill-probe","workflowPhase":"Probe","spawnDepth":1,"requestShape":"foreground","requestNonInteractive":false}
```

- `agentType` is always `workflow-subagent`. The role is the `label` of the `agent()` call (`description`), and the phase is `workflowPhase`. `deliver` must therefore use stable labels per role (`implement #<nr>`, `gate #<nr>`, `review #<nr>`, `fix #<nr>`, `pr #<nr>`).
- agentlens reads only `<session>/subagents/*.jsonl` (`claude_code.rs`, `jsonl_files` does not recurse). Today the cost of workflow subagents does not show up in agentlens at all. Filed as GravionLabs/agentlens#436.

## 6. Skills in OpenCode

`opencode debug skill` in agentlens lists the apm-hub skills from `~/.agents/skills` (`implementation`, `code-review`, `issue-planning`, `detect-techstack`, …), from `~/.config/opencode/skills`, from `~/.claude/skills` and from the project's `.claude/skills`. Skills need no copy for OpenCode.

## 7. OpenCode plugins and shell denial

Not run: OpenCode had no provider credentials (`opencode providers list`: 0), so no session could start. From the built-in `customize-opencode` skill of OpenCode 1.19.5:

- `"plugin": ["@scope/name@1.2.3"]` in `opencode.json` loads a plugin from npm; `.opencode/plugins/*.ts` are found without config.
- A plugin can hook `tool.execute.before` and `permission.ask`.
- Denying `gh pr create` and `gh pr merge` needs no plugin at all: `"permission": { "bash": { "*": "allow", "gh pr create*": "deny", "gh pr merge*": "deny" } }` (the last matching rule wins).

Consequence: keryx#13 can be a permission config that keryx ships or documents instead of plugin code. A live check needs a provider login (`opencode auth login`, e.g. GitHub Copilot) and is part of #827.

## 8. OpenCode session events

The event types of `@opencode-ai/sdk` 1.19.5 cover what keryx#7 needs: `session.created`, `session.status`, `session.idle`, `session.error`, `permission.asked` / `permission.replied`, `question.asked` / `question.replied`. A plugin receives them through its `event` hook. Waiting for the user is `permission.asked` or `question.asked`.

## Decisions for the follow-up PBIs

- #826 `deliver`: script next to `SKILL.md`, `scriptPath` for project installs, inline fallback for global installs; stable labels per role; `model` and `effort` on every `agent()`; the allowlist of the target repository is a precondition the skill checks.
- #827 OpenCode: needs a provider login before its trial.
- keryx#7: map the events of section 8. keryx#13: permission rules first, plugin only if they are not enough.
- apmw stays frozen: neither the workflow script nor the OpenCode deny rule needs it.
