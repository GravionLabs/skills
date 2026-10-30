## Skill Writing Rules

Single source of truth for how a skill is shaped. `skill-audit` and `skill-slim` check against this file; do not restate these rules elsewhere.

### Load it when

- A skill is being created, edited, audited or slimmed
- A skill includes CLI examples, command output, or output-format decisions

### Placement and naming

- Every skill lives in `skills/<group>/<name>/`; the folder is its group. A new group folder needs a plugin with a description in `.claude-plugin/marketplace.json`; `node scripts/check-marketplace.mjs --fix` then lists the skill there and in the installer's `groups.json`. Skill names are unique across all groups: `npx skills add --skill <name>` selects by name, and installs are flat (`.claude/skills/<name>/`).
- `name`: kebab-case, 1-64 chars, matches the directory exactly, no leading, trailing or consecutive hyphens.

### Frontmatter

Skills must load unchanged on GitHub Copilot, Claude Code and OpenCode, so only agentskills.io-legal keys are allowed at the top level.

| Field | Rule |
|---|---|
| `name` | Required. See naming above. |
| `description` | Required. Imperative, 1-1,024 chars, says what the skill does and when to use it, includes specific trigger keywords, not so broad it fires for unrelated tasks. |
| `license` | Optional. SPDX identifier (e.g. `MIT`). |
| `metadata` | Optional. Map of free-form string annotations (authorship, version). Hosts ignore them; no nested platform configuration. The one host key is `opencode/autoinvoke: 'false'`, required next to `disable-model-invocation`. |
| `disable-model-invocation` | Optional. `true` only for skills the user always starts (scaffolding, release workflows): the description leaves the model's skill list, `/<name>` still works (Claude Code, VS Code Copilot). Always paired with `metadata.opencode/autoinvoke: 'false'`. Never on skills other skills load by name. |
| `user-invocable` | Optional. `false` hides the skill from the `/` menu while the model may still load it. |
| `context` / `agent` | Optional. `context: fork` runs the skill in a subagent (Claude Code); `agent` names the agent definition. Only for self-contained skills that return a small result and never ask the user or spawn subagents; the body states the return contract. |

**Forbidden top-level keys (🔴):** `allowed-tools` (matches no platform's tool vocabulary), `model` (platform-specific, goes stale), `compatibility` (a uniform claim carries no information), `chronicle-hints` (move to `metadata:`), anything else (breaks strict loaders). Custom annotations go under `metadata:`. See `docs/concepts/skill-frontmatter.md` for the reasoning.

```yaml
---
name: my-skill
description: >
  Does X. Use this skill when the user needs Y or Z, even if they do not
  mention X explicitly.
---
```

### Body

- ≤ 100 lines (enforced by `src/generators/skill-size-validator.test.ts`); workflow, not long specs
- Order: one-sentence overview, prerequisites, numbered instructions, gotchas, one-line report format
- Write conditional behavior as `If X → do Y; otherwise do Z`; no equal alternatives without a default
- Shell blocks use ` ```powershell `
- Include a code block only when the agent will copy it verbatim; inline fallbacks ≤ 5 lines, longer ones go in `references/`
- Don't explain what the model already knows (tool basics, generic best practice, flag tables); state repo conventions, contracts and non-obvious gotchas
- No vague advice ("handle errors appropriately"); not tied to one concrete task (hardcoded names, URLs, ids)
- Paths to `scripts/`, `references/` and `assets/` are relative to the skill directory; state that once in the skill. Never rely on `$env:SKILL_DIR`.

### Companion directories

| Content | Location |
|---|---|
| Workflow steps the agent follows | `SKILL.md` body |
| Stable specs, error codes, long tables | `references/` (conditional load: "If X, read references/Y.md") |
| Templates and output formats > ~20 lines | `assets/` or `templates/` (conditional load) |
| Repeatable multi-step commands | `scripts/` (`.ps1` preferred) |

- Scripts: flag-based, `--help`, no interactive prompts, data on stdout, diagnostics on stderr, non-zero exit on failure, dependencies declared and pinned
- Load references conditionally, never all of them; keep chains one level deep (A → B, never A → B → C); paths relative from the skill root
- Compose, don't duplicate: if two skills share a workflow, one delegates to the other (`implementation` dispatches to `<lang>-implementation` instead of restating each language's conventions)
- No content duplicated between body and references, or between two skills

### CLI output

- Prefer the smallest useful output (`--quiet`, `--nologo` and the like when they hide no useful failures)
- Use JSON only when the next step parses, compares or persists it; never wrap plain text in JSON to look structured
- Keep sample output short and focused on the signal the next step needs

### Validation

- Directory name matches `name`; no forbidden frontmatter keys (`allowed-tools`, `model`, `compatibility`, `chronicle-hints`; annotations go under `metadata:`)
- Description says when to use it; references are conditional; nothing duplicated across body and references
- All shell fences are ` ```powershell `
