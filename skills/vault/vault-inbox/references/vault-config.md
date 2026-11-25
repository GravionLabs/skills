# Vault configuration the vault skills read

`.nixe/config.json` in the vault root (GravionLabs/nixe, ADR "vault configuration in .nixe"):

```json
{
  "language": "de",
  "folders": {
    "inbox": "Posteingang",
    "recipes": { "path": "Areas/Kochen/Rezepte", "description": "Recipes of dishes" }
  },
  "files": { "school-profile": "Profile.md" },
  "templates": { "folder": "Vorlagen" }
}
```

- **Roles.** Standard roles: `inbox`, `journal`, `templates`, `attachments`, `projects`, `areas`, `resources`, `archive`, `clippings`, `subjects`, `sources`, `exams`. A role missing in `folders` resolves to its English default (`Inbox`, `Journal`, `Templates`, `Attachments`, `Projects`, `Areas`, `Resources`, `Archive`, `Resources/Clippings`, `Subjects`, `Sources`, `Exams`). An entry is a path or `{ "path", "description" }`.
- **Profiles combine.** One vault can hold PARA and school: one `language`, and `subjects` below `areas`. `files.school-profile` is the school profile file (default `Profile.md`); the older `files.profile` is read as a fallback.
- **Own roles.** Any other key (`recipes`, `exams`, …). The `description` says what belongs in the folder. A folder without a role is never a target unless the user asks for it. A role whose folder is missing is reported, not removed.
- **Language.** `language` (BCP 47, default `en`) is the language of the notes you write. A note's `lang` frontmatter wins. Frontmatter keys stay English, note titles are never translated.
- **Templates.** `templates.folder`, then `.obsidian/templates.json` (`folder`), then the role `templates`. A template is a hint: when none exists, use the structure in the skill. Never rely on an Obsidian-only feature (core plugins, Templater syntax): plain Markdown and `[[wikilinks]]` only.
- Run `pwsh scripts/Get-VaultRoles.ps1 -Vault <root>` (this skill's folder) to get all of it as JSON.

## Permissions the vault's `.claude/settings.json` needs

The skills fetch pages and convert images. The vault allows these tools (as in `obsidian-vault-template`):

```json
{
  "permissions": {
    "allow": [
      "WebFetch",
      "WebSearch",
      "Bash(uvx trafilatura *)",
      "Bash(grep *)",
      "Bash(rg *)",
      "Bash(find *)",
      "Bash(ls *)",
      "Bash(heif-convert *)",
      "Bash(magick *)",
      "Bash(pdftoppm *)"
    ]
  }
}
```

| Entry                              | Used by                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------ |
| `WebFetch`, `WebSearch`            | `vault-clip`, `vault-summarize`, `vault-recipe` (fallback to read a page)      |
| `Bash(uvx trafilatura *)`          | `vault-clip`, `vault-recipe`: page text as Markdown                            |
| `Bash(grep *)`, `rg`, `find`, `ls` | duplicate and related-note search in every skill                               |
| `Bash(heif-convert *)`, `magick`   | `vault-inbox`, `vault-recipe`: HEIC to JPG; `vault-inbox`: resize large photos |
| `Bash(pdftoppm *)`                 | `vault-inbox`: one JPEG per page of a scanned PDF                              |

The skills run without them, but each use asks for a permission.
