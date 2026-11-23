# Group `vault`

Skills of the `vault` group and what each one does. Read before changing a skill of this group.

All skills find folders only through the roles of `.nixe/config.json` of the vault (`folders`, default English names; `scripts/Get-VaultRoles.ps1` of `vault-inbox` prints roles, `language` and the template folder as JSON), write notes in the vault's `language` (a note's `lang` wins; frontmatter keys stay English) and name no Obsidian-only feature as required. Templates: `templates.folder`, then `.obsidian/templates.json`, then the role `templates`; a missing template falls back to the structure in the skill. Never delete or overwrite a note. The permissions the vault's `.claude/settings.json` needs are in `vault-inbox/references/vault-config.md`.

`vault-inbox` (merges the `inbox` skills of both vault templates; files into the standard roles and into own roles by their `description`; a note that fits no role stays in the inbox with a reason; never files into a folder without a role), `vault-clip` (verbatim clipping of a page into the `clippings` role), `vault-summarize` (structured summary note), `vault-meeting` (meeting note with action items), `vault-decision` (decision record), `vault-weekly-review` (review into the `journal` role), `vault-recipe` (recipe into the own role `recipes`; without the role it stops and points to `/vault-setup role recipes`).
