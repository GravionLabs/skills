---
name: vault-pdf
description: 'Write notes of a vault as PDF files, one note or the notes of a folder, rendered by Nixe with diagrams and math. Use when notes should be printed, sent or handed in as PDF, e.g. the summaries and timelines of a school topic before an exam.'
---

# vault-pdf

Arguments: `$ARGUMENTS` (a note, a folder or a school topic; optional `--out <folder>`).

Resolve the vault first: `pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints the `language` and every folder role. Use only these paths. See `../vault-inbox/references/vault-config.md`.

## Steps

1. **Check the tools.** `nixe` (the command line of GravionLabs/nixe) and Chrome, Chromium or Edge. Missing: say what to install and stop. The script finds the browser itself; `PDF_BROWSER` or `-Browser` names another one.
2. **Pick the notes.**
   - A note or folder named by the user: that.
   - A school topic (school profile): the topic folder below the `subjects` role, only the summary and the timeline, with the name patterns of the vault's language (`../school-summary/references/school-vault.md`): German `'* – Zusammenfassung.md','* – Zeitstrahl.md'`, English `'* - Summary.md','* - Timeline.md'`.
   - Unclear what is meant: ask, do not print the whole vault.
3. **Print.**

   ```powershell
   pwsh scripts/Export-VaultPdf.ps1 -Vault <vault root> -Path <note or folder> [-Filter <patterns>] [-OutDir <folder>]
   ```

   A folder skips the roles `inbox`, `templates`, `attachments`, the `sources` folder of each topic and hidden folders; `-Exclude` adds more (a name without slash matches at any depth). Each PDF lands next to its note, with `--out` in that folder.

4. **Check the warnings.** "timeline too wide": the Mermaid timeline prints too small. Offer to split it into one `timeline` block per section (2 to 5 periods each); the table of the timeline note prints fine.
5. **Keep PDFs out of Git.** They are generated. Check `.gitignore`; propose the entries and add them only after the user agrees:
   - school vault (German): `**/* – Zusammenfassung.pdf` and `**/* – Zeitstrahl.pdf`; English: `**/* - Summary.pdf`, `**/* - Timeline.pdf`
   - with `--out <folder>`: `<folder>/`

   Never ignore `*.pdf` as a whole: PDFs in `attachments` and `sources` are originals.

6. **Report** the written PDFs (paths), the warnings and what was skipped.

## Rules

- Never change a note to make it print; propose the change (e.g. splitting a timeline) and wait.
- Never delete a PDF the script did not write; it overwrites only its own output path.
- The script prints one vault-relative path per PDF; a failure stops with the note that failed.
- Bridge: once Nixe writes PDFs itself (GravionLabs/nixe#598), the script is replaced by `nixe export <note> --format pdf --out <file>`.
