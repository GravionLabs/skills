# ADR 0006: oxlint and oxfmt are the lint and format standard

- Status: Proposed
- Date: 2026-11-20
- Issues: #769, Feature #763

## Context

Today a TypeScript repository formats and lints with Prettier plus ESLint (`setup-prettier-eslint-husky`) or with Biome (`setup-biome-husky`). Two toolchains mean two sets of configs, hooks and rules in `implementation`, and ESLint with type-aware rules is slow.

Pilot findings:

- Skills repository (Node): [#764](https://github.com/GravionLabs/skills/issues/764).
- Angular: [GravionLabs/poimen#1050](https://github.com/GravionLabs/poimen/issues/1050).

Summary (`agent-guardrails-2026-11-20.md` §4): oxfmt replaces Prettier and the Biome formatter. oxlint replaces Biome and ESLint for `.ts`, with `@angular-eslint/eslint-plugin` loaded as a JS plugin, and type-aware rules come for free. oxlint does not lint `.html`, because custom parsers are not supported for JS plugins.

## Decision

oxlint and oxfmt are the lint and format standard of every TypeScript repository (plain TypeScript, Node and Angular). Conditions:

1. **Exact versions.** oxlint and oxfmt are pinned to exact versions (no range) in `package.json`; an update is a deliberate change.
2. **Angular probe test.** An Angular repository carries a test that proves the `@angular-eslint` rules run through oxlint (a probe file that must produce the expected findings). If the probe fails after an update, the update is not taken.
3. **ESLint only for `.html`.** ESLint stays in an Angular repository only for Angular templates (`.html`) with `@angular-eslint/template`. It lints no `.ts`.
4. **Inline templates move to `.html` files.** A component template that is linted is an `.html` file, not an inline `template:` string, because oxlint cannot see inside it.

## Consequences

- `setup-biome-husky` and `setup-prettier-eslint-husky` stop being the standard. A follow-up PBI replaces them with an oxlint/oxfmt setup (hook, configs, Angular variant with ESLint for `.html`); the two skills are deprecated or removed there, following the rename policy in CONTRIBUTING.md.
- `detect-techstack` reports oxlint/oxfmt (and ESLint for `.html`) as the detected tools, and still reports Biome, Prettier and ESLint for existing repositories.
- `implementation` (`Format-Changed.ps1`, `-Lint`, `references/lint.md`, the `format` and `lint` keys of `.agents/config.json`) gets oxfmt and oxlint as the TypeScript defaults; the Angular default adds the ESLint run for `.html`.
- `project-setup` offers the oxlint/oxfmt option first for ts and ng.
- Existing repositories migrate on their own schedule; the old options stay selectable until they are removed.
- Easier: one formatter and one linter for all `.ts`, faster runs, type-aware rules without a separate ESLint setup.
- Harder: the toolchain is young, so versions are pinned and the Angular probe guards it; inline templates have to be moved out; the Angular repository keeps ESLint as a second tool for `.html`.
- Out of scope here: changes to skills, configs or CI (PBI #770 and later).

## Alternatives

- **Biome everywhere plus ESLint for Angular.** One tool for plain TypeScript, but Biome cannot run the `@angular-eslint` rules, so Angular keeps ESLint for `.ts` and `.html` and the formatter and linter would differ between repositories. Not chosen.
- **Status quo (Prettier plus ESLint, or Biome).** No migration cost, but two toolchains stay, type-aware linting stays slow, and the skills keep two setups in sync. Not chosen.
