# ADR 0006: oxlint and oxfmt are the lint and format standard

- Status: Accepted (2026-11-20)
- Date: 2026-11-20
- Issues: #769, #763

## Context

The TypeScript repositories use three setups: Biome (kontex, noesis, skills), ESLint with `angular-eslint` plus Prettier (agentlens, ariadne, mcp-studio, poimen), Biome plus ESLint (helix), oxlint plus Prettier (elysion). The skills ship two setup skills for them, `setup-biome-husky` and `setup-prettier-eslint-husky`, and `implementation` knows both. Agents write most of the code, so one tool set means one set of rules, one set of error messages and one setup skill.

A pilot compared oxlint 1.93.0 and oxfmt 0.78.0 with the current tools in skills (#764) and poimen (GravionLabs/poimen#1050):

- oxfmt formats TypeScript, Angular templates (including `@if`, `@for`, `@switch`, `@defer`, `@let`), CSS, SCSS, JSON, Markdown and YAML. In poimen 14 of 475 files differ from Prettier (closing brackets after inline elements, long union types); in skills no TypeScript file differs from Biome, 21 Markdown files get a blank line around HTML comments.
- oxlint loads `@angular-eslint/eslint-plugin` as a JS plugin and reported the same five class violations of a probe component as ESLint. JS plugins cannot use a custom parser, so oxlint does not lint `.html` templates.
- The Biome rules in use map 1:1 to oxlint rules. Type-aware linting (oxlint-tsgolint) works without setup and found 39 new issues in skills, 5 correct `no-unsafe-optional-chaining` findings in poimen.
- Speed is not a deciding factor at our sizes (poimen: lint 6.0 s to 3.8 s, format check 6.7 s to 1.2 s; skills: below one second either way).

Sources: oxc docs on the [formatter](https://oxc.rs/docs/guide/usage/formatter.html), [JS plugins](https://oxc.rs/docs/guide/usage/linter/js-plugins.html) and [type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware.html).

## Decision

oxlint and oxfmt are the lint and format tools of every TypeScript repository.

- oxfmt replaces Prettier and the Biome formatter.
- oxlint replaces Biome and ESLint for `.ts` and `.js`, with type-aware rules on. Angular repositories load `@angular-eslint/eslint-plugin` as a JS plugin.
- ESLint stays only for Angular `.html` templates (`@angular-eslint/eslint-plugin-template`). Components keep their templates in `.html` files; an inline `template:` outside spec files is a lint error, so ESLint never has to read `.ts` files.
- oxlint, oxfmt and oxlint-tsgolint are pinned to exact versions, because JS plugins are alpha. Updates go through Renovate with the release-age delay.
- Angular repositories keep a probe component with known class and template violations and a test that oxlint and ESLint still report them.
- One setup skill, `setup-oxc-husky`, replaces `setup-biome-husky` and `setup-prettier-eslint-husky`.

## Consequences

- One formatter config and one linter config shape for all repositories; `implementation` formats with `oxfmt` and lints with `oxlint` once `.oxfmtrc.json` / `.oxlintrc.json` exist. Biome and Prettier stay supported there until the last repository is migrated.
- Angular repositories still run two linters, oxlint for TypeScript and ESLint for templates. When oxlint supports custom parsers for JS plugins, ESLint can go.
- Each repository needs one migration PR with a reformat commit (listed in `.git-blame-ignore-revs`). Biome lint configs have no migration tool; the rules are mapped by hand.
- oxfmt formats every supported file unless ignored, unlike Biome's `files.includes` allowlist; templates and fixtures need explicit ignore patterns.
- The `roadmap` skill must write its HTML comment markers the way oxfmt formats them.
- A JS plugin regression in an oxlint update shows up as a failing probe test, not as silently missing findings.

## Alternatives

- **Biome everywhere, ESLint for Angular.** The first recommendation. Biome cannot load ESLint plugins, so Angular repositories would keep ESLint for TypeScript and templates and Prettier or Biome for formatting; no type-aware rules.
- **Status quo.** Three setups and two setup skills to maintain; agents meet different rules per repository.
- **Vite+ (`vp`) as a wrapper.** Bundles the same oxc tools; out of scope until the plain tools are in place.
