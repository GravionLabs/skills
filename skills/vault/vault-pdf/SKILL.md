---
name: vault-pdf
description: 'Write notes of a vault as PDF files, one note or the notes of a folder, rendered by Nixe with diagrams and math. Use when notes should be printed, sent or handed in as PDF, e.g. the summaries and timelines of a school topic before an exam.'
---

# vault-pdf

Arguments: `$ARGUMENTS` (a note, a folder or a school topic; optional `--out <folder>`).

Resolve the vault first: `pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints the `language` and every folder role. Use only these paths. See `../vault-inbox/references/vault-config.md`.

## Steps

1. **Check Nixe.** Needs Nixe 1.16.0 or newer (`nixe`, the command line of GravionLabs/nixe); no browser. `nixe export --help` prints the usage (exit 2 is expected). `nixe` missing: say to install it and stop. No line `nixe export <folder> --format pdf` in the usage: the Nixe is too old; tell the user to update to 1.16.0 or newer and stop.
2. **Pick the notes.**
   - A note or folder named by the user: that.
   - A school topic (school profile): the topic folder below the `subjects` role, only the summary and the timeline, with these `--include` globs in the vault's language (`../school-summary/references/school-vault.md`): German `'* – Zusammenfassung.md'`, `'* – Zeitstrahl.md'`, English `'* - Summary.md'`, `'* - Timeline.md'`.
   - Unclear what is meant: ask, do not print the whole vault.
3. **Print one note.** `<note>` is its path below the vault root, `<file>` an absolute path: next to the note (`.pdf` instead of `.md`), with `--out` in that folder.

   ```powershell
   nixe export <note> --format pdf --out <file> --vault <vault root>
   ```

4. **Or print a folder.** `--out .` writes each PDF next to its note; with `--out <dir>` (absolute) the paths below the folder are kept. One `--include` per file name glob; without any, every note. `--exclude` takes one folder path, no name or glob, so list the role folders, hidden folders and the `sources` folder of each topic:

   ```powershell
   $vault = '<vault root>'; $folder = '<absolute folder>'
   $roles = (pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault $vault | ConvertFrom-Json).folders
   $skip = @($roles.inbox.path, $roles.templates.path, $roles.attachments.path)
   $skip += Get-ChildItem -LiteralPath $folder -Directory -Recurse -Force |
     Where-Object { $_.Name -eq (Split-Path -Leaf $roles.sources.path) -or $_.Name.StartsWith('.') } |
     ForEach-Object { [IO.Path]::GetRelativePath($vault, $_.FullName) -replace '\\', '/' }
   $here = [IO.Path]::GetRelativePath($vault, $folder) -replace '\\', '/'
   # A folder the user named is printed, even when it is or lies in one of these.
   $excludes = $skip | Where-Object { -not "$here/".StartsWith("$_/") } | ForEach-Object { '--exclude', $_ }
   nixe export $folder --format pdf --out <dir> --include '<glob>' --vault $vault @excludes
   ```

   Notes with `publish: false` and files ignored by Git are skipped. stdout lists the written PDFs, stderr the progress; exit 1 means at least one note failed, the others are written. No path on stdout and exit 0: nothing matched. On Linux without a display run it under `xvfb-run`.

5. **Keep PDFs out of Git.** They are generated. Check `.gitignore`; propose the entries and add them only after the user agrees:
   - school vault (German): `**/* – Zusammenfassung.pdf` and `**/* – Zeitstrahl.pdf`; English: `**/* - Summary.pdf`, `**/* - Timeline.pdf`
   - with `--out <folder>`: `<folder>/`

   Never ignore `*.pdf` as a whole: PDFs in `attachments` and `sources` are originals.

6. **Report** the written PDFs (paths), the failed notes and what was skipped.

## Rules

- Never change a note to make it print; propose the change and wait.
- Never delete a PDF. An export overwrites its output path: when a PDF there is not an earlier export, ask first.
