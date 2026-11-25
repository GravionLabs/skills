---
name: school-exercises
description: 'Create exercises with solutions for a school topic, graded by difficulty level. Use when a pupil wants to practise a topic or quiz themselves.'
---

# school-exercises

Topic and wishes: `$ARGUMENTS` (`<topic> [count|focus]`).

Resolve the vault first and read the profile: `pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints `language`, the roles and `files.school-profile`. Roles, profile fields, file name patterns and the rules every note follows: `../school-summary/references/school-vault.md` (read it).

## Steps

1. Find the topic folder, read the profile, the transcriptions and the summary. Use textbook exercises in the sources as a model for style and level.
2. Write the exercises note (name pattern of the vault's language). It exists: append a section `## Round N` with different exercises.

## Structure

About 10 exercises in three blocks of rising difficulty, after the German KMK requirement levels (AFB) or the curriculum's equivalent:

- **Level I - Reproduce** (name, describe, summarize)
- **Level II - Apply** (explain, compare, classify, calculate, analyse)
- **Level III - Evaluate** (discuss, judge, take a position, develop)

Middle school: focus on I and II. Upper school: focus on II and III. Headings in the note language.

```markdown
## Level I - Reproduce

**1.** Name three causes of the hyperinflation of 1923.

> [!success]- Solution
> …

> [!tip]- Hint
> Optional nudge for demanding tasks.
```

## Rules

- Every task starts with an operator and is solvable without questions.
- Solutions always collapsed; with full working for calculations, as bullet points of what a good answer contains for text tasks.
- Mix formats: short answer, matching, gap text, calculation, source work, reasoning.
- Ask only what is in the sources.
- Maths/science: choose numbers so the result is traceable and recompute every solution.
