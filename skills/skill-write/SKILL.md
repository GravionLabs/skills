---
name: skill-write
description: 'Create or edit a SKILL.md that loads unchanged on Copilot, Claude Code and OpenCode. Use when drafting a skill.'
---

## Prerequisites

- Skill path, or the domain and name for a new skill
- Read `references/skill-writing-rules.md` and apply it throughout
- For a new skill, start from `assets/skill-template-optimized.md`

Paths to `references/` and `assets/` are relative to this skill's directory.

## Instructions

### 1. Plan and validate

1. Location: `skills/<name>/` (flat, one directory per skill). Pick the group in `.claude-plugin/marketplace.json` it belongs to; a new group needs a new plugin entry there.
2. Validate the name: kebab-case, 1-64 chars, matches the directory, no leading, trailing or consecutive hyphens.

### 2. Create and structure

3. Create `SKILL.md` first; add `scripts/`, `references/` or `assets/` only if they reduce repeated context.
4. Frontmatter: `name` and `description` only, plus optional `license` and `metadata`. The only other keys allowed are the client keys in the rules (`disable-model-invocation` paired with `metadata.opencode/autoinvoke: 'false'`, `user-invocable`, `context: fork`, `agent`); add them only when the rules say so. Never `allowed-tools`, `model`, `compatibility` or `chronicle-hints` at top level; annotations go under `metadata`.
5. Body: one-sentence overview, numbered instructions, gotchas, one-line report format. Stay ≤ 100 lines.

### 3. Validate

6. All shell blocks use ` ```powershell `.
7. Scripts (if any): flag-based, `--help`, data on stdout, diagnostics on stderr, non-zero on error.
8. Final check: name matches directory, description says when to use it, references are conditional, nothing duplicated across body and references or with another skill.
9. Run `node scripts/check-marketplace.mjs --fix` at the repo root so its group in `.claude-plugin/marketplace.json` lists the skill.

## Gotchas

- Directory name must match `name` exactly
- Keep reference chains one level deep

Report: summary, files created or changed, and `skill-audit <skill-path>` to verify.
