---
name: vault-inbox
description: 'Process everything in the vault inbox (clippings, photos, PDFs, transcripts, loose notes) into filed, linked notes, also into own folder roles by their description. Use when new material was captured and needs to be organized.'
---

# vault-inbox

Optional argument: `$ARGUMENTS` (one file or folder instead of the whole inbox, a subject or topic hint).

Resolve the vault first: `pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints the `language`, every folder role (`path`, `description`, `exists`) and the template folder. Use only these paths, never a fixed folder name. See `../vault-inbox/references/vault-config.md`.

## Steps

1. List the items in the `inbox` folder. Empty: say so and stop.
2. Read each item. Images and PDFs are read visually; HEIC needs a JPG copy first (`heif-convert` or `magick`), the original stays. Group pages that belong together and order them (page numbers, text flow, capture time).
3. Decide what each item is: reference note, meeting, decision, recipe, project update, journal entry, or a source for a subject. Meetings follow `vault-meeting`, decisions `vault-decision`, recipes `vault-recipe`.
4. Pick the folder. Read **every role that has a `description`** and match the item against it; use `projects`, `areas`, `resources`, `subjects`, `sources` by their usual meaning. A role with a `profile` file (`files.profile`) is read first for subject and topic. An existing topic folder wins over a near-identically named new one.
5. Search the vault for notes on the same subject and extend a match instead of creating a near-duplicate.
6. Create or extend the note from the template of the template folder (`Note`, or the fitting one), file it, and link related notes with `[[wikilinks]]`. Write in the vault's `language` (a note's `lang` wins); frontmatter keys stay English.
7. Move the originals into the `attachments` folder (or next to the note in a subject's source folder when the roles say so), never delete them, and reference them in the `source` property.
8. Report: what was filed where, what stayed in the inbox and why, what was uncertain.

## Rules

- File only into a folder that has a role. A note that fits no role stays in the inbox, with a one-line reason in the report.
- When the destination is ambiguous, leave the item and ask instead of guessing.
- Transcribe faithfully before interpreting; mark `[illegible]` and `[?]`. Text on a page the user wrote stays as it is.
- Capture action items as `- [ ]` with owner and due date when known.
- Never delete or overwrite a note; append or ask.
- The tools the skills need are listed in `references/vault-config.md` (permissions of the vault's `.claude/settings.json`).
