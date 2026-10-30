# Skill Companion Directories

A skill can ship files next to its `SKILL.md`. `npx skills add` installs the whole skill directory, so these files arrive in the consuming project together with the skill.

## Directory convention

```
skills/<skill-name>/
  SKILL.md          ← the skill (≤ 100 lines)
  scripts/          ← PowerShell 7+ procedures, run as `pwsh scripts/<Name>.ps1`
  references/       ← long material the skill loads conditionally
  templates/        ← starter files copied into the user's project
  assets/           ← binary or static files (images, sample data)
```

Only create the directories you need. Paths inside `SKILL.md` are relative to the skill directory; the skill states that once near the top.

| Directory | Content | Examples |
| :-- | :-- | :-- |
| `scripts/` | Repeatable procedures with parameters | `New-Solution.ps1`, `Get-SkillReport.ps1` |
| `references/` | Specs, rule tables, workflow variants | `review-rules.md`, `sub-issues.md`, `skill-writing-rules.md` |
| `templates/` | Files to copy or adapt | `Directory.Packages.props`, `eslint.config.mjs`, `vitest.setup.ts` |
| `assets/` | Static files | `skill-template-optimized.md` |

## Loading references conditionally

A reference is read only when needed. The skill says when:

```markdown
For release branches read `references/release-branches.md`.
```

Keep the decision in `SKILL.md` and the detail in the reference. This is how skills stay under the size limit without losing information.

## Example: `dotnet-create-solution`

```
skills/dotnet-create-solution/
  SKILL.md
  scripts/New-Solution.ps1
  templates/
    Directory.Build.props
    Directory.Packages.props
    .editorconfig
```

`SKILL.md` asks the two questions the script needs, calls `pwsh scripts/New-Solution.ps1`, and lists the templates the script copies to the solution root.

## Adding companion files to an existing skill

1. Put the file in the matching directory inside the skill.
2. Reference it from `SKILL.md` with a relative path and say when it is used.
3. Run the repo checks: `pnpm test` (size limit) and the skill report for dangling references:

   ```powershell
   pwsh skills/skill-slim/scripts/Get-SkillReport.ps1 -Root .
   ```

The `skill-write` skill (group `skill-tooling`) walks through this.
