---
name: ng-helix
description: 'Build or modify Angular UI with Helix components (@gravionlabs/helix-ui): forms, dialogs, confirmations, lists, charts. Use when a task mentions Helix.'
license: MIT
---

## Basic Rules

- Verify the package and version first: `npm ls @gravionlabs/helix-ui`; the APIs here are those of Helix `release/next`, so check an unknown input against the installed package
- Which element to use for a need (binding): the skill `ng-implementation`, `references/helix.md`
- UX: read [Helix UX rules](https://github.com/GravionLabs/helix/blob/main/docs/UX-RULES.md) and, when it exists, the app's `docs/STYLEGUIDE.md`
- All components are standalone: add each class to the component's `imports`
- Import from `@gravionlabs/helix-ui`; the chart from `/chart`, validators from `/validators`
- Load `styles.css` and `tokens.css` of the package once, globally

## References

Load the file for the task at hand. Paths are relative to this skill's directory.

| Topic          | File                       | Load when                                                                     |
| -------------- | -------------------------- | ----------------------------------------------------------------------------- |
| Component APIs | `references/components.md` | Selector, class, entry point or inputs of a component, service or validator   |
| Recipes        | `references/recipes.md`    | Building a form field, form, dialog, confirmation, path field or list of rows |

## Gotchas

- **`hxDialogFooter` works only inside `<hx-dialog>`**: a component opened by `HxDialogService` renders its actions in its own template
- **Confirmations need a host**: without `<hx-confirm-dialog />` (or `<hx-confirm-popup />` for a `target`) in the app, nothing is shown
- **`hx-field` holds exactly one control** (`hx-input`, `hx-checkbox`, `hx-radio`, `hx-switch`, `hx-select`); an input group is not supported inside it
- **Reactive and template-driven errors have no text**: set `error` on the field
- **Helix `Validators` are not Angular's**: their errors are keyed by `ValidatorKey`, and the field does not see `required` from them (set `required`)
- **`hx-select` id and description**: `inputId`, `ariaLabel`, `ariaDescribedby`, not the native attributes
