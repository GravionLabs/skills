---
name: vault-inbox
description: 'Import the vault inbox: read everything (photos, PDFs, clippings, transcripts, loose notes), propose a target per item, and file into linked notes and folder roles only what the user approved. Use when captured material was dropped into the inbox and needs to be organized.'
---

# vault-inbox

Optional argument: `$ARGUMENTS` (one file or folder instead of the whole inbox, a subject or topic hint).

Resolve the vault first: `pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints the `language`, every folder role (`path`, `description`, `exists`) and the template folder. Use only these paths, never a fixed folder name. See `../vault-inbox/references/vault-config.md`.

Four phases in this order: review, propose, approve, import. Steps 1–5 read only: nothing in the vault is created, changed, moved or deleted before the approval. One run covers every profile of the vault.

## Review

1. List the items in the `inbox` folder. Empty: say so and stop.
2. Read each item. Images and PDFs are read visually; a HEIC that cannot be read gets a temporary JPG copy outside the vault (`heif-convert` or `magick`). Group pages that belong together and order them (page numbers, text flow, capture time).

## Propose

3. Decide what each group is: reference note, meeting, decision, recipe, project update, journal entry, or a source for a subject.
4. Pick the target. Read **every role that has a `description`** and match the group against it; use `projects`, `areas`, `resources`, `subjects`, `sources` by their usual meaning. With the school role `subjects`, read the school profile (`files.school-profile`) first for subject and topic. PARA targets (projects, areas, resources, own roles) and school targets (`<subjects>/<Subject>/<Topic>/`) are proposed side by side in one table. When `subjects` lies below `areas`, class material goes to its topic folder there, never loose into an area. An existing topic folder wins over a near-identically named new one. Search the vault for notes on the same subject: extending a match beats a near-duplicate.
5. Show one table, one row per group, then stop and wait for the answer:

   | #   | Files | What it is | Target (role, area or subject/topic; existing or new folder) | Note type | Uncertain points |
   | --- | ----- | ---------- | ------------------------------------------------------------ | --------- | ---------------- |

   A group without a target gets a row too: target `stays in the inbox`, with the reason. Under the table, name the files that will be converted: their unconverted originals are removed from the inbox.

## Approve

6. The user approves all rows, some rows ("1–3 ok, 4 to Mathe") or corrects a target. Only approved rows are imported; a corrected row is approved with the new target unless the user says otherwise. A row that is not approved stays in the inbox, untouched. No answer, or an unclear one: ask, write nothing.

## Import

7. Convert first what is not converted yet: a photo larger than 2000 px or a HEIC becomes a JPEG (quality 80, at most 2000 px); a scanned PDF becomes one JPEG per page at about 150 dpi; a PDF with real (selectable) text stays. Convert into a temporary folder outside the vault:

   ```powershell
   magick "<photo>" -auto-orient -resize "2000x2000>" -quality 80 "<temp>/<name>.jpg"
   pdftoppm -jpeg -jpegopt quality=80 -r 150 "<scan.pdf>" "<temp>/<name>"
   ```

8. Move each file (converted or not; never re-encoded again) under a speaking name into the `sources` folder of the topic, or into the `attachments` folder for every other target. An existing name is never overwritten: add a suffix. A loose note that is itself the filed note moves to its target folder. Git must store each file only once: no copy stays behind; remove the unconverted original only after you opened its converted files and found every page complete and readable.
9. Create or extend the note from the template of the template folder (`Note`, or the fitting one), file it, link related notes with `[[wikilinks]]` and reference the moved files in the `source` property. Meetings follow `vault-meeting`, decisions `vault-decision`, recipes `vault-recipe` (converting and moving files follows this skill). Write in the vault's `language` (a note's `lang` wins); frontmatter keys stay English.
10. Report: what was filed where, what stayed in the inbox and why, what was uncertain. The imported files left the inbox; after a full import the inbox is empty.

## Rules

- File only into a folder that has a role, or one the user names in a correction. A group that fits no role stays in the inbox, with a one-line reason.
- When the destination is ambiguous, say so in "Uncertain points" instead of guessing.
- Transcribe faithfully before interpreting; mark `[illegible]` and `[?]`. Text on a page the user wrote stays as it is.
- Capture action items as `- [ ]` with owner and due date when known.
- Never delete or overwrite a note; append or ask. A conversion that failed leaves its original in the inbox.
- The tools the skills need are listed in `references/vault-config.md` (permissions of the vault's `.claude/settings.json`).
