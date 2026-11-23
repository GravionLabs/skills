---
name: vault-meeting
description: 'Turn raw meeting notes, a transcript or a recording summary into a structured meeting note with decisions and action items. Use after a meeting or when meeting material lands in the inbox.'
---

# vault-meeting

Arguments: `$ARGUMENTS` (title, optionally a file with the raw notes). No raw material: ask for it.

Resolve the vault first: `pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints the `language`, every folder role (`path`, `description`, `exists`) and the template folder. Use only these paths, never a fixed folder name. See `../vault-inbox/references/vault-config.md`.

## Steps

1. Read the raw material and the `Meeting` template of the template folder (fall back to: date, attendees, topics, decisions, action items).
2. Find date, attendees and the project or area. Date or project unclear: ask.
3. Create `YYYY-MM-DD Title.md` in the folder of the project (`projects` role) or area (`areas` role), in the vault's `language`. Link attendees and the project as `[[wikilinks]]`.
4. For each significant decision offer a record with `vault-decision`.
5. Report the action items at the end of the answer.

## Rules

- A distillation: topics and outcomes, not a transcript.
- Every action item: `- [ ] Owner: task (due YYYY-MM-DD)`; owner or date not stated: `[?]`, never a guess.
- Decisions are statements ("Use X for Y"), not discussion.
- Frontmatter keys stay English (`type: meeting`, `date`, `project`).
- Never overwrite an existing note.
