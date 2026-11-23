## Vault core rules

- Read the folder roles in `.nixe/config.json` (`folders`; `pwsh .claude/skills/vault-inbox/scripts/Get-VaultRoles.ps1`) and file notes only into a folder with a role. A note that fits no role stays in the inbox, with a reason.
- Write notes in the vault's `language` (a note's `lang` wins); frontmatter keys stay English.
- Never delete or overwrite a note; append, or ask.
- Use plain Markdown and `[[wikilinks]]`; no feature that only one editor offers.
- Do not commit: the user (or the Git sync of the app) commits.
- Skills and this block are updated with `/vault-setup update`; write your own rules below, in "Vault-specific rules".
