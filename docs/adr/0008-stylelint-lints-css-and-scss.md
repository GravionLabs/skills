# ADR 0008: Stylelint lints CSS and SCSS

- Status: Proposed
- Date: 2026-11-23
- Issues: #922
- Extends: [ADR 0006](0006-oxlint-and-oxfmt-are-the-lint-and-format-standard.md)

## Context

ADR 0006 makes oxlint and oxfmt the standard. oxlint lints only JS and TS (and the `<script>` blocks of `.vue`, `.svelte`, `.astro`), so CSS and SCSS have no linter once Biome is gone. Repositories that moved away from Biome lost its CSS rules without a replacement (GravionLabs/helix#1116). `ng-implementation` already recommends Stylelint for the design-token rules, but ADR 0006 and `setup-oxc-husky` do not mention it.

## Decision

- Stylelint with `stylelint-config-standard-scss` is the standard for CSS and SCSS lint. oxfmt stays the formatter for those files.
- `setup-oxc-husky` sets Stylelint up in every Angular project; for a plain TypeScript project it is optional (`-Stylelint`).
- The rules are the former Biome CSS rules (`declaration-block-no-duplicate-properties`, `selector-pseudo-element-no-unknown` allowing `ng-deep`) plus the token rules of `ng-implementation` `references/style-lint.md`. The config has one source: `setup-oxc-husky/templates/stylelint.config.mjs`.
- `implementation` lints changed `.css` and `.scss` files with Stylelint once `stylelint.config.*` exists.

## Consequences

- Angular repositories get one more dev dependency pair (`stylelint`, `stylelint-config-standard-scss`) and a `lint:styles` script that is part of `lint`.
- `lint-staged` runs `stylelint --fix`, then `oxfmt`, on staged `*.{css,scss}`.
- The token rules stay optional for repositories without a style guide: the template names `docs/STYLEGUIDE.md` in its messages.
- Migrating existing repositories is one PR each (helix: GravionLabs/helix#1168).

## Alternatives

- **Biome for CSS only.** A second formatter and linter family just for styles; against ADR 0006.
- **No CSS lint.** Duplicate properties and unknown pseudo-elements go unnoticed; the token rules would have no home.
