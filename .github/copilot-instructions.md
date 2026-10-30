# GravionLabs skills — Project Instructions

GravionLabs/skills is a collection of agent **skills** installed with `npx skills`. Read [AGENTS.md](../AGENTS.md) for the layout, the group/skill table, conventions and commands. Everything below only adds Copilot-specific notes.

## Where things are

- Skills: `skills/<group>/<name>/SKILL.md` (+ `scripts/`, `references/`, `templates/`, `assets/`); the folder is the group
- Groups: `.claude-plugin/marketplace.json`, one plugin per group folder (`node scripts/check-marketplace.mjs --fix` lists the skills there and in the installer's `groups.json`)
- Tests: `test/` (Vitest). `pnpm test`
- `docs/skill-list.md` is generated (`pnpm run generate`) and gitignored. Do not commit it.

## Skill frontmatter

```yaml
---
name: my-skill # kebab-case, matches the directory
description: >
  What it does. Use this skill when … (specific triggers).
license: MIT # optional
metadata: { key: value } # optional, free-form strings
---
```

No other top-level keys. Body ≤ 100 lines, shell fences ` ```powershell `.

## Code review guidelines

Focus on correctness, contradictions between skills, duplicated rules, and broken references. Do not flag style nits.
