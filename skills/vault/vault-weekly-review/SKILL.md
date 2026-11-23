---
name: vault-weekly-review
description: 'Review the past week from journal, meeting and project notes and plan the next week. Use at the end of the week or when asked for a status overview.'
---

# vault-weekly-review

Optional argument: `$ARGUMENTS` (ISO week `YYYY-Www`, default the current week).

Resolve the vault first: `pwsh ../vault-inbox/scripts/Get-VaultRoles.ps1 -Vault <vault root>` prints the `language`, every folder role (`path`, `description`, `exists`) and the template folder. Use only these paths, never a fixed folder name. See `../vault-inbox/references/vault-config.md`.

## Steps

1. Collect notes created or modified in that week from the `journal`, `projects` and `areas` folders (file dates and `created` properties).
2. Collect open tasks (`- [ ]`) from those notes and from active projects.
3. Create `Weekly Review YYYY-Www.md` in the `journal` folder from the `Weekly Review` template (fall back to the three parts below), in the vault's `language`:
   - **What happened:** grouped by project, with links.
   - **Open loops:** overdue or stale tasks, open questions, items still in the `inbox` folder.
   - **Next week:** a short prioritized list from active projects and due dates.
4. Report stale projects (no activity for 3+ weeks) and propose moving them to the `archive` folder. Move nothing without confirmation.

## Rules

- Report only what the notes show; invent no progress.
- One screen; details live in the linked notes.
- Never overwrite an existing review.
