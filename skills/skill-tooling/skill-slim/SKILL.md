---
name: skill-slim
description: 'Measure skills across a package or repo, classify content as keep, move, delete or dedupe, then apply approved changes. Use to slim or trim skills or cut token cost.'
---

## Prerequisites

- Repo root; run read-only analysis first — **no edits before the user approves the findings**
- Follow `../skill-write/references/skill-writing-rules.md` for the target shape

Paths to `scripts/` are relative to this skill's directory.

## Instructions

### 1. Measure

```powershell
pwsh scripts/Get-SkillReport.ps1 -Root .
pwsh scripts/Get-SkillReport.ps1 -Root . -FailOnDangling   # CI: exit 1 on a dangling reference
```

JSON on stdout: sizes, skills over the 100-line limit, `danglingCandidates` across `SKILL.md` and `references/*.md`, also references into other skills (known false positives: `scripts/skill-report-allowlist.txt`, `skill: ref` per line with a comment why), `duplicatedLines` across skills.

### 2. Classify

Read each large skill and its references. For every block ask: **could the model write this itself?**

| Bucket | Test | Action |
|---|---|---|
| Keep | Repo convention, tool contract, schema, non-obvious gotcha, script or template | Leave; tighten wording |
| Delete | Generic best practice, tool basics, flag tables, debugger commands | Delete; fold any repo-specific rule into the matching `<lang>-implementation` |
| Move | Specs, long tables, examples > ~20 lines | `references/` or `assets/`, loaded conditionally |
| Deduplicate | Same steps in several skills, repeated boilerplate | One skill owns it; others delegate |

Also flag: contradictions between skills (tools, folders, naming), forbidden frontmatter keys (`compatibility`, `chronicle-hints`, `model`, `allowed-tools`: 🔴, remove or move to `metadata:`), `bash` fences, links that leave the package.

### 3. Report and wait

Show a findings table (skill, bucket, what, estimated bytes saved), the decisions needed from the user, and a phased plan (deletions → merges → splits → consistency fixes). **Stop for approval.**

### 4. Apply

One commit per phase. After each: `pnpm test`, `node scripts/check-marketplace.mjs --fix` (repo root), re-run the report (no new dangling references, no skill over the limit), grep for removed skill names.

## Gotchas

- Deleting a skill leaves references in `AGENTS.md`, `.claude-plugin/marketplace.json` and generated docs — grep for the name
- Keep a trimmed skill's `description` triggering on the same requests
- Never trim vendored content you cannot verify; condense to the non-obvious facts only
