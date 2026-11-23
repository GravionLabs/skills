---
name: vault-recipe
description: 'Save a recipe from a URL, a photo, a file or dictated text as a structured recipe note with ingredients, steps, servings and source. Use when a recipe should be kept in the vault.'
---

# vault-recipe

Arguments: `$ARGUMENTS` (URL, file from the inbox, or a title for dictated text; optional `--servings N` to scale).

Resolve the vault first: `pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints the `language`, every folder role (`path`, `description`, `exists`) and the template folder. Use only these paths, never a fixed folder name. See `../vault-inbox/references/vault-config.md`.

The recipes live in the own role `recipes`. When `folders` has no `recipes` entry, stop and tell the user to run `/vault-setup role recipes` (it creates the role with its description); never file into a guessed folder.

## Steps

1. **Duplicates.** Search the `recipes` folder for the title and source (`grep -ril "<title or url>" <recipes>`). Found: report it and extend that note instead of a new one.
2. **Read the source.** URL: `uvx trafilatura --markdown --with-metadata -u "<url>"`, else WebFetch; prefer JSON-LD `@type: Recipe` data when the page has it. Photo or PDF: read visually (HEIC to JPG first with `heif-convert` or `magick`, original stays). Text without source: as given, `source` empty.
3. **Write** `<recipes>/<Title>.md` from the `Recipe` template of the template folder (fall back to: Ingredients, Steps, Notes, Source). Ingredients one per line `- amount unit ingredient`, groups as subheadings; steps numbered, one action each. Amounts, times and temperatures exactly as in the source; only with `--servings` scale proportionally and keep the original servings under "Notes".
4. **Frontmatter:** `type: recipe`, `source`, `servings`, `prep_time`, `cook_time`, `tags` (course, cuisine, main ingredient, lower case), and the `area` link when the vault uses one.
5. **Link.** Add it to the overview note of the recipes' area when there is one. Move originals to the `attachments` folder and embed them under "Source".
6. **Report** the path, what the source lacked (e.g. no servings), what was read uncertainly (`[?]`).

## Rules

- Invent no ingredient, step or amount; a missing field stays empty and is reported.
- Own tips go into "Notes" marked `> [!info] Added context (not from the source)`.
- Write in the vault's `language` (a note's `lang` wins); a recipe in another language is translated, the original dish name stays in parentheses.
