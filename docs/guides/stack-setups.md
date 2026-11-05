# Stack setups

Set up a repository for a stack, then verify a change. Each scenario starts from a repository with Node.js 22+ (for `npx skills`) and PowerShell 7+ (see the [quick start](../quick-start.md)). Prompts are shown as you would type them in Copilot, Claude Code or OpenCode; the agent selects the skills by their descriptions, so naming them is optional.

## Set up a .NET repository

```text
/skill-manage dotnet
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

## Set up tooling in a TypeScript or Angular project

```text
/skill-manage ts
/skill-manage ng   # Angular only; brings angular/skills (angular-developer)
```

| Goal                                   | Prompt                                                 | Skill                                              |
| :------------------------------------- | :----------------------------------------------------- | :------------------------------------------------- |
| Migrate from npm to pnpm               | "Switch this project to pnpm."                         | `ts-pnpm-workflow`                                 |
| Pre-commit linting, plain TS (Biome)   | "Set up linting and formatting with pre-commit hooks." | `setup-biome-husky`                                |
| Pre-commit linting, Angular (Prettier) | "Set up linting and formatting with pre-commit hooks." | `setup-prettier-eslint-husky`                      |
| New Angular workspace                  | "Create an Angular app named shop with Vitest."        | `ng-create-project`                                |
| Standalone component                   | "Add a product-list component under features/catalog." | `ng-implementation` (`references/component.md`)    |
| NgRx Signal Store                      | "Create a signal store for the cart."                  | `ng-implementation` (`references/signal-store.md`) |
| AG Grid Enterprise                     | "Add a grid with row grouping and Excel export."       | `ng-ag-grid`                                       |
| MCP server                             | "Generate an MCP server with a search tool."           | `ts-mcp-server-generator`                          |

## Verify a change

```text
Run the build and the tests.
```

`detect-techstack` names the `<lang>-test` skill of the project; it holds the build, test and lint commands. Run them before the pull request and paste a failure's first error line into the next prompt instead of the whole log.

## Next

[Work an issue by hand](work-an-issue-by-hand.md), [fix a bug](fix-a-bug.md) or [deliver planned issues](deliver.md).
