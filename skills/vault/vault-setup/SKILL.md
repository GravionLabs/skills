---
name: vault-setup
description: 'Set up a notes vault as a PARA or school vault (folders, language, templates, skills), set folder roles, and update the skills and core rules of CLAUDE.md. Use for "/vault-setup para", "/vault-setup school", "/vault-setup role" or "/vault-setup update".'
---

# vault-setup

Arguments: `$ARGUMENTS`. With an argument the skill runs without a question; Nixe calls it the same way. Run the script from the vault root (or pass `-Vault <root>`); paths are relative to this skill's folder:

```powershell
pwsh scripts/Invoke-VaultSetup.ps1 setup para|school [-Language en|de] -Vault <root>
pwsh scripts/Invoke-VaultSetup.ps1 role <name> <path> [description] -Vault <root>
pwsh scripts/Invoke-VaultSetup.ps1 role -List -Vault <root>
pwsh scripts/Invoke-VaultSetup.ps1 role -Remove <name> -Vault <root>
pwsh scripts/Invoke-VaultSetup.ps1 update -Vault <root>
```

Without an argument ask which of the four the user wants (profile and language for `setup`). Relay the script's summary.

## setup `para|school [--language <code>]`

Default language `en`; `en` and `de` ship. Another code: English folder names and templates, a notice, notes in that language.

1. Installs the profile's skills as a project install: `npx skills add GravionLabs/skills --skill … -y` (list in `assets/profiles.json`); `skills-lock.json` stays. Without `npx` a warning, the rest runs.
2. Writes `language`, `folders`, `files.profile` (school), `templates.folder` to `.nixe/config.json`. An existing entry of `folders`, `files` or `templates` is kept, a missing one is added.
3. Creates the folders in that language (`Exams/` or `Klausuren/`) and copies the templates (`Templates/Exam.md` or `Vorlagen/Prüfung.md`; PARA: Note, Meeting, Decision, Recipe). school: the profile file from the assets of `school-summary`.
4. `CLAUDE.md`: the core block between `<!-- vault-core:start -->` and `<!-- vault-core:end -->`, then the profile section under "Vault-specific rules".

Never overwrites an existing note: existing files are reported as `kept`.

## role

`role <name> <path> [description]` sets or changes a role and creates the folder. Rules as in Nixe (GravionLabs/nixe#438): the name is unique (lower case, digits, `-`), one role per folder, the path is inside the vault, an own role (not one of the standard roles in `../vault-inbox/references/vault-config.md`) needs a description. `-List` prints name, path and description; `-Remove <name>` removes the role, the folder stays.

## update

1. `npx skills check`, then `npx skills update`.
2. Replaces the core block of `CLAUDE.md` from `assets/core/CLAUDE-core.md`: a missing block is inserted at the top, a changed one replaced, the text outside the markers (the vault's own "Vault-specific rules") stays unchanged.
3. Summarize what changed. No commit: the user (or Nixe's Git sync) commits.

## Rules

- The core block contains the rule: read the folder roles in `.nixe/config.json`, file notes only into a folder with a role.
- Never delete or overwrite a note; never commit.
