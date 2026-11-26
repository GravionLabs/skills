# Migration from raw controls to Helix

For an app that still has raw controls or its own control CSS. Take the steps in order; a step is done when its check passes. Which element replaces which: skill `ng-implementation`, `references/helix.md`.

Lint setup (install, configs, scripts, fast checks): skill `ng-implementation`, `references/style-lint.md`, section "Helix projects". Rules and allowlist: [Helix lint preset](https://github.com/GravionLabs/helix/blob/main/docs/LINT.md).

## 1. Inventory

Count raw `<button>`, `<input>`, `<select>`, `<textarea>` and `<progress>` and the component CSS that styles controls.

- Report mode: install the preset and add its ESLint config, but leave `pnpm lint` and the fast `checks` as they are. The findings of `helix/no-raw-control` are the inventory:

```powershell
pnpm exec eslint "**/*.html"
```

- The rule reads `.html` files only. For inline templates, and when the preset cannot be installed, search the text. This also lists controls that already have a Helix directive; drop those by hand:

```powershell
git grep -nE '<(button|input|select|textarea|progress)([[:space:]/>]|$)' -- '*.html' '*.ts'
```

- Control CSS (no lint rule finds it); check the hits and the inline `styles` of components:

```powershell
git grep -nE '(^|[[:space:],>+~}])(button|input|select|textarea|progress)([[:space:],.:{[]|$)|[.#][[:alnum:]_-]*(btn|button|input|select)' -- '*.css' '*.scss'
```

Check: the migration issue lists the count per file for templates and stylesheets.

## 2. Reference form

Migrate one typical form with `hx-field` and the form recipe of [recipes.md](recipes.md). Later forms copy it.

Check: `pnpm exec eslint <template>` reports nothing, the tests pass, and Enter submits and Escape cancels.

## 3. Dialogs, then settings, then panels and lists

One group after the other, with the recipes of [recipes.md](recipes.md):

| Group            | Use                                                         | Its check                                                      |
| ---------------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| Dialogs          | `hx-dialog`, `HxDialogService`, `HxConfirmationService`     | `git grep -nE '\bconfirm\(' -- '*.ts'` shows no browser dialog |
| Settings         | `hx-field` with `hx-switch`, `hx-checkbox`, `hx-select`     | Each setting is still read and saved in the tests              |
| Panels and lists | `hx-list` with `hx-list-row`, `hx-button` for panel actions | Rows are reached and chosen with the keyboard                  |

Check: after each group, `pnpm exec eslint <templates>` reports nothing for its templates, and the check of its row passes.

## 4. Drop local control CSS

When a screen has no raw controls left, delete its CSS that styles controls. Layout CSS stays; a look the inputs of a control cannot give is a change of the theme tokens.

Check: the CSS search of step 1 has no hit that styles a control in the stylesheets of the screen, and the screen looks right in the light and the dark theme.

## 5. Lint with an allowlist

Wire the preset into `pnpm lint` and the fast `checks` as `style-lint.md` says. So that the run is green from the start, list every not yet migrated file in a `helixAllow({ files, rules, reason })` entry: after the preset in the ESLint config, in `overrides` of the Stylelint config. Name files, not whole folders, so new files are checked.

```js
// eslint.config.mjs
import helix, { helixAllow } from '@gravionlabs/helix-lint/eslint';
import { defineConfig } from 'eslint/config';

export default defineConfig(
  { ignores: ['dist/**'] },
  helix,
  helixAllow({
    files: ['src/app/settings/settings.html'],
    rules: ['helix/no-raw-control'],
    reason: 'Not yet migrated: settings',
  }),
);
```

For Stylelint, import `helixAllow` from `@gravionlabs/helix-lint/stylelint` and name its rules: `color-no-hex`, `function-disallowed-list`, `declaration-property-value-allowed-list`.

Then repeat steps 3 and 4 for the listed files, and remove each file from the list in the change that migrates it. Add no new file to the list.

Check: `pnpm lint` passes after every change and blocks in CI. The migration is done when no "not yet migrated" entry is left; only a lasting exception with its own reason, such as a token file, may stay.
