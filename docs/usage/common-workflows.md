# Common Workflows

End-to-end scenarios with the GravionLabs skills. Each one starts from a repository with Node.js 22+ (for `npx skills`) and PowerShell 7+ (see the [README](../../README.md#quick-start)). Prompts are shown as you would type them in Copilot, Claude Code or OpenCode; the agent selects the skills by their descriptions, so naming them is optional.

---

## Workflow 1: Set up a .NET repository

```text
/skills-install dotnet
```

or without the installer: `npx skills add GravionLabs/skills --skill dotnet-implementation --skill dotnet-test --skill dotnet-create-solution --skill implementation --skill detect-techstack --skill code-review`.

1. **Scaffold the solution**

   ```text
   Use dotnet-create-solution to create a NuGet library called Gravion.Payments.
   ```

   The skill asks for library vs. application and the project template, then runs its script. You get `src/`, `test/`, `Directory.Build.props`, `Directory.Packages.props` (Central Package Management) and `.editorconfig`.

2. **Implement with tests**

   ```text
   Implement a PaymentProcessor that validates IBANs.
   ```

   `implementation` loads `dotnet-implementation` and `dotnet-test`: every change comes with NUnit tests using NSubstitute and Shouldly.

3. **Review before committing**

   ```text
   Review the current diff.
   ```

   `code-review` applies the `## Review rules` of `dotnet-implementation` and reports blocking findings and notes. It never edits.

The same pattern works with `ts`, `py` and `ng`: `<lang>-create-project` or `ng-create-project` to scaffold, `implementation` to build, `code-review` to check.

---

## Workflow 2: Work a GitHub issue end to end

```text
/skills-install core -g    # once per machine: shared, github, delivery, statusline
/skills-install            # per project: detects the stack
```

One issue per session, see [Working mode](../working-mode.md).

1. **Plan a large issue into sub-issues** (optional)

   ```text
   Plan issue #42.
   ```

   `planner` explores the codebase and plans one level down (Epic to Features, Feature to PBIs, PBI to tasks) with `blocked_by` and size. After you approve, `github-issue` creates the issues with native sub-issue and blocked-by links.

2. **Implement**

   ```text
   Implement issue #42.
   ```

   `github-issue` reads the labels (`epic`, `feature`, `pbi`, `bug`), checks for sub-issues and follows the matching reference workflow. It creates the branch per the conventional-commit type, and `implementation` loads the stack skill and ships tests with every change. Bugs go through `diagnose`: a red feedback loop first, then the fix with a regression test.

3. **Review the diff**

   ```text
   Review the current diff.
   ```

   `code-review` lists blocking findings and notes. Fix the blocking ones; the pull request is the second review.

4. **Open the pull request**

   ```text
   Create a PR for this branch.
   ```

   `github-pull-request` generates a conventional title and a structured body from the commits and the linked issue, then creates it with `gh`.

To deliver planned issues PBI by PBI, interactive or unattended, use [`/deliver`](../delivery.md).

---

## Workflow 3: Verify a change

```text
Run the build and the tests.
```

`detect-techstack` names the `<lang>-test` skill of the project; it holds the build, test and lint commands. Run them before the pull request and paste a failure's first error line into the next prompt instead of the whole log.

---

## Workflow 4: Set up tooling in a TypeScript or Angular project

```text
/skills-install ts
/skills-install ng   # Angular only; brings angular/skills (angular-developer)
```

| Goal                                   | Prompt                                                 | Skill                                              |
| :------------------------------------- | :----------------------------------------------------- | :------------------------------------------------- |
| Migrate from npm to pnpm               | "Switch this project to pnpm."                         | `ts-pnpm-workflow`                                 |
| Pre-commit linting, plain TS (Biome)   | "Set up linting and formatting with pre-commit hooks." | `setup-biome-husky`                                |
| Pre-commit linting, Angular (Prettier) | "Set up linting and formatting with pre-commit hooks." | `setup-prettier-eslint-husky`                      |
| New Angular workspace                  | "Create an Angular app named shop with Vitest."        | `ng-create-project`                                |
| Standalone component                   | "Add a product-list component under features/catalog." | `ng-implementation` (`references/component.md`)    |
| NgRx Signal Store                      | "Create a signal store for the cart."                  | `ng-implementation` (`references/signal-store.md`) |
| AG Grid Enterprise                     | "Add a grid with row grouping and Excel export."       | `ng-ag-grid-developer`                             |
| MCP server                             | "Generate an MCP server with a search tool."           | `ts-mcp-server-generator`                          |

---

## Workflow 5: Changelog from conventional commits

```text
Finish the release with an updated changelog.
```

`github-release finish` runs git-cliff for the changelog and, on first use, installs git-cliff, creates `cliff.toml` from its template and adds a `changelog` script (see its `references/cliff-setup.md`). Commit titles produced by `github-issue` and `github-pull-request` already follow the conventional-commit format it expects.

---

## Cross-references

- [Skills](../concepts/skills.md)
- [All skills](../skill-list.md) (generated)
- [Prerequisites](../prerequisites.md)
