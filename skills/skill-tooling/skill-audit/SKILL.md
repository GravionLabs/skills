---
name: skill-audit
description: 'Audit one skill against the writing rules and emit a findings report. Use to check or verify a single skill; for a package or repo use skill-slim.'
---

Audit one skill against the repo's skill-writing rules and report findings by severity.

## Prerequisites

- Skill path
- Read `../skill-write/references/skill-writing-rules.md` (the rules) and `references/audit-checklist.md` (the checks)

Paths to `references/` are relative to this skill's directory.

## Instructions

1. Read `{skill-dir}/SKILL.md` and list every file under `{skill-dir}/`.
2. Run the checklist across frontmatter, body, `scripts/`, `references/` and `assets/`.
3. Record each finding as severity, category, finding, recommendation.
4. If findings exist → show them grouped 🔴 → 🟡 → 🟢 and stop; on the user's go apply them in severity order per `skill-writing-rules.md`, then re-audit. If a fix means rewriting the body → follow `skill-write`. Otherwise report PASS.

## Gotchas

- A zero-finding report is valid; do not invent fixes.
- `bash`/`sh` fences and forbidden frontmatter keys (`compatibility`, `chronicle-hints`, `model`, `allowed-tools`) are always 🔴 and must be fixed; everything else is the user's call.
- Do not apply fixes without the user's go.
- Confirm before renaming or moving a skill.
- Do not widen the scope beyond the findings; ask before large restructures.

Report: `Audit: <name> — PASS (<n> checks)` or `FINDINGS (<n> 🔴 · <m> 🟡 · <x> 🟢)`, followed by the findings list and `Re-audit: skill-audit <skill-path>`.
