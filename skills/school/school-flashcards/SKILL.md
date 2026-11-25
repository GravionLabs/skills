---
name: school-flashcards
description: 'Create flashcards of a school topic in the format of the Obsidian plugin Spaced Repetition. Use for vocabulary, terms, dates, formulas and definitions.'
---

# school-flashcards

Topic: `$ARGUMENTS`

Resolve the vault first and read the profile: `pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints `language`, the roles and `files.school-profile`. Roles, profile fields, file name patterns and the rules every note follows: `../school-summary/references/school-vault.md` (read it).

## Steps

1. Find the topic folder, read the profile, the transcriptions and the summary.
2. Write the flashcards note (name pattern of the vault's language). It exists: append only new cards and keep existing lines unchanged (the plugin stores the learning state as a comment on the card).

## Format

The note has the tag `#flashcards/<Subject>` directly under the frontmatter so the plugin finds the deck (the plugin must list `#flashcards` as flashcard tag; a vault that already uses another tag keeps it, e.g. `#karteikarten`). Plain Markdown, no plugin needed to read it.

```markdown
#flashcards/History

When was the Weimar Republic proclaimed?::9 November 1918

What did Article 48 of the Weimar Constitution regulate?
?
Emergency powers of the president: he could suspend basic rights and govern without the Reichstag.

la maison:::the house
```

- `Question::Answer`: one-line card
- `?` on its own line: multi-line card
- `:::`: card in both directions (vocabulary)

## Rules

- One card, one fact. Three small cards beat one overloaded card.
- Ask so that exactly one answer is right.
- Guide value 15-30 cards per topic; comprehension questions belong in `school-exercises`.
- A blank line between cards. Formulas as LaTeX.
