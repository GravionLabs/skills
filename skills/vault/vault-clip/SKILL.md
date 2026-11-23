---
name: vault-clip
description: 'Save the full text of a web page as a Markdown clipping with source, author and retrieval date. Use when a page should be kept verbatim for later reference, not just summarized.'
---

# vault-clip

Arguments: `$ARGUMENTS` (one or more URLs; `--summary` also writes a `vault-summarize` note).

Resolve the vault first: `pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints the `language`, every folder role (`path`, `description`, `exists`) and the template folder. Use only these paths, never a fixed folder name. See `../vault-inbox/references/vault-config.md`.

## Steps

1. **Duplicates.** Search the `clippings` folder for the URL (`grep -rl "<url>" <clippings>`). Found: report it and stop unless the user asked to refresh it.
2. **Extract.** First that yields a readable article: `uvx trafilatura --markdown --with-metadata -u "<url>"`; WebFetch for the full text as Markdown without navigation or ads; browser tools when the page needs a login or JavaScript. All fail or only fragments: say so, never save a partial clipping unmarked.
3. **Write** `<clippings>/<Title>.md` from the `Clipping` template of the template folder (structure below when there is none). The body is the extracted text without navigation, cookie banners, comments and related-article blocks; not shortened, rephrased or translated. Headings, lists, tables and code stay; images stay links to the original.
4. **Frontmatter:** `type: clipping`, `source` (URL), `author`, `published` (empty if unknown), `clipped` (today), `site` (hostname), `tags` (topics, lower case).
5. **Link.** Search for notes on the same subject and add `[[wikilinks]]` under "Related"; append a pointer line to a matching topic note.
6. With `--summary`, run `vault-summarize` on the new clipping.
7. **Report** the path, the extraction method and what could not be captured (paywall, truncation, missing author or date).

Without a template: frontmatter, `# <Title>`, the text, `## Related`.

## Rules

- A clipping is a verbatim copy. Own text goes only into a `> [!info] Added context (not from the source)` callout after the body, in the vault's `language`.
- Mark unreadable passages `[illegible]`; never fill gaps from memory.
- File name: the page title in title case, no site name, unique in the vault.
- Never delete or overwrite a clipping; a refresh writes `<Title> (YYYY-MM-DD).md`.
