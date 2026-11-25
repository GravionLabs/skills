---
name: school-summary
description: 'Write a study summary of a school topic from its transcriptions. Use when a pupil wants to revise a topic for an exam or says "summarize this topic".'
---

# school-summary

Topic: `$ARGUMENTS`

Resolve the vault first and read the profile: `pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints `language`, the roles and `files.school-profile`. Roles, profile fields, file name patterns and the rules every note follows: `../school-summary/references/school-vault.md` (read it).

## Steps

1. Find the topic folder `<subjects>/<Subject>/<Topic>/`, read the profile and all transcriptions in its `sources` folder. No transcription: suggest `/vault-inbox` first.
2. Write the summary (name pattern of the vault's language). It exists: extend it, do not replace it.
3. Report what went in and where the sources were gappy, illegible or contradictory.

## Structure

Headings and callout titles in the note language; English form:

```markdown
# <Topic>

> [!abstract] Key points
> 3-5 sentences worth knowing by heart.

## <One section per subtopic>

Explaining text, short paragraphs, lists only for enumerations.

## Connections

Cause → effect, comparison, classification (Mermaid or table where it helps).

## Terms

| Term | Explanation |

## Typical exam questions

3-5 questions as they are asked on this material (no answers; those are in `school-exercises`).

## Open points

What the sources lack, what was illegible or contradictory.
```

## Rules

- Length by grade: middle school about one screen per subtopic, upper school longer with classification and evaluation.
- Explain in your own words, with an example where it helps understanding.
- By subject:
  - **History/politics:** causes, course, consequences; actors and their interests; dates with meaning, not date lists.
  - **Maths/physics/chemistry:** definition, formula, conditions, worked example, typical mistakes.
  - **Languages/literature:** content, characters, motifs, stylistic devices with quotes from the sources.
  - **Biology/geography:** processes as numbered steps or a diagram, terms cleanly separated.
