---
name: vault-summarize
description: 'Write a structured summary of a note, file (PDF, image, text) or URL and save it as a note. Use when a document or page needs to be condensed into what matters.'
---

# vault-summarize

Source: `$ARGUMENTS` (note, file path or URL).

Resolve the vault first: `pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints the `language`, every folder role (`path`, `description`, `exists`) and the template folder. Use only these paths, never a fixed folder name. See `../vault-inbox/references/vault-config.md`.

## Steps

1. Read the full source (notes and files with the file tools, URLs with a fetch tool). Not completely readable: say what is missing.
2. Search the vault for a note on this source or subject; extend it instead of duplicating.
3. Write `<Title> – Summary.md` in the fitting folder (`resources` for reference material, the project or area folder when the source belongs to one; a summary of a clipping goes next to the topic, not into `clippings`), with the structure below. Link related notes.
4. Report where it was saved and which parts of the source were unclear.

## Structure

Headings and the callout title are written in the vault's `language`; the English form:

```markdown
# <Title> – Summary

> [!abstract] Key takeaways
> 3-5 sentences that capture the essence.

## Main points

Grouped by theme, not by order of appearance.

## Details worth keeping

Figures, names, definitions, quotes (verbatim, with location in the source).

## Open questions

Gaps, contradictions, things to verify.
```

A callout is plain Markdown on other readers (a blockquote); that is fine.

## Rules

- Condense, do not copy; usually under 20 % of the source.
- Frontmatter: `type: summary`, `source` (what and date), `lang` when it differs from the vault's `language`.
- Separate what the source says from your assessment and label the latter.
