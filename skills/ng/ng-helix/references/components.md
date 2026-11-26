# Helix components

Selectors, exported classes and the inputs an app uses, from `docs/components/*.md` and the sources of Helix `release/next`. Entry point `@gravionlabs/helix-ui` unless a section says otherwise. `[(x)]` is a two-way binding.

## Dialog: `HxDialog`, `HxDialogService`, `HxDialogRef`

| Selector    | Inputs                                                                                                                                                                                                 | Outputs               |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------- |
| `hx-dialog` | `[(visible)]`, `header`, `size` (`sm`, `md`, `lg`), `width`, `height`, `modal`, `closable`, `closeOnEscape`, `dismissableMask`, `position`, `panelClass`, `closeLabel`, `ariaLabel` (without `header`) | `(shown)`, `(hidden)` |

- Slots (plain attributes, no import): `[hxDialogFooter]` for the actions, `[hxDialogHeader]` after the title.
- `HxDialogService.open(Component, config)`: `config` is `HxDialogConfig` (the inputs above except `visible` and `size`, plus `data`). It returns `HxDialogRef`: `close(result)`, `closed` (the result, `undefined` when closed some other way), `componentInstance`.
- Inside the opened component: `inject(HX_DIALOG_DATA)` and `inject(HxDialogRef)`.
- Focus starts on the first tabbable element of the content, is trapped while modal and returns on close.

## Confirmation: `HxConfirmationService`, `HxConfirmDialog`, `HxConfirmPopup`

| Selector            | Shows                                  |
| ------------------- | -------------------------------------- |
| `hx-confirm-dialog` | Questions without `target`, centred    |
| `hx-confirm-popup`  | Questions with `target`, at an element |

- Put the component once in the app (root); neither takes inputs from the app.
- `confirm(c)` or `await confirmAsync(c)` (resolves `true` or `false`).
- `c` is an `HxConfirmation`: `message`, `header`, `icon`, `acceptLabel` (`'Yes'`), `rejectLabel` (`'No'`), `acceptSeverity` (`'primary'`), `target` (element or event), `accept()`, `reject()`.
- Focus starts on the reject button; Escape rejects.

## Field: `HxField`

| Selector   | Inputs                               |
| ---------- | ------------------------------------ |
| `hx-field` | `label`, `hint`, `error`, `required` |

- Renders label, hint, error and required marker and wires `id`, `aria-describedby`, `aria-invalid`, `aria-required`.
- The error shows once the control is invalid and touched; without a form a set `error` shows at once. `required` marks only, it adds no validator.

## Input group: `HxInputGroup`, `HxInputGroupAddon`

| Selector               | Inputs |
| ---------------------- | ------ |
| `hx-input-group`       | none   |
| `hx-input-group-addon` | none   |

- Children: `input[hx-input]` (`HxInput`), `hx-select`, `hx-input-number`, `hx-icon-field`, `button[hx-button]` (`HxButton`), addons (text or icon).
- Label the field itself; reference an addon that carries information with `aria-describedby`.

## Message: `HxMessage`

| Selector     | Inputs                                                                                                                                                                      | Outputs   |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| `hx-message` | `severity` (`success`, `info`, `warn`, `error`, `secondary`, `contrast`), `variant` (`filled`, `outlined`, `simple`), `size`, `icon`, `closable`, `closeLabel`, `life` (ms) | `(close)` |

## Fieldset: `HxFieldset`

| Selector      | Inputs                                  |
| ------------- | --------------------------------------- |
| `hx-fieldset` | `legend`, `toggleable`, `[(collapsed)]` |

## Select: `HxSelect`

| Selector    | Inputs                                                                                                                                                                                                                                                                                                             |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hx-select` | `options`, `optionLabel`, `optionValue`, `optionDisabled`, `placeholder`, `filter`, `filterPlaceholder`, `filterBy`, `emptyMessage`, `emptyFilterMessage`, `showClear`, `variant`, `size`, `fluid`, `disabled`, `invalid`, `inputId`, `ariaLabel`, `ariaLabelledby`, `ariaDescribedby`, `compareWith`, `[(value)]` |

- Works with `ngModel`, reactive forms and signal forms (`[formField]`).

## Checkbox and switch: `HxCheckbox`, `HxSwitch`

| Selector             | Inputs                              |
| -------------------- | ----------------------------------- |
| `input[hx-checkbox]` | `size` (`small`, `medium`, `large`) |
| `input[hx-switch]`   | none                                |

- Native elements with `type="checkbox"`: forms and `indeterminate` work as on any input. A switch takes effect immediately; name the setting.

## List: `HxList`, `HxListRow`

| Selector                                | Inputs                                                                        |
| --------------------------------------- | ----------------------------------------------------------------------------- |
| `hx-list`                               | `role` (`list`, `listbox`)                                                    |
| `button[hx-list-row]`, `a[hx-list-row]` | `selected`, `current` (`boolean`, `page`, `step`, `location`, `date`, `time`) |

- Content classes: `hx-list-row-icon`, `hx-list-row-label`, `hx-list-row-meta`.
- The app sets `selected` and `current`; the list handles arrows, Home, End and is one tab stop.

## Progress: `HxProgressBar`

| Selector          | Inputs                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------- |
| `hx-progress-bar` | `value` (0 to 100), `mode` (`determinate`, `indeterminate`), `showValue`, `unit`, `ariaLabel` |

## Chart: `HxChart`, entry point `@gravionlabs/helix-ui/chart`

| Selector   | Inputs                                                                                                                                                                             | Outputs        |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| `hx-chart` | `type` (`bar`, `line`, `scatter`, `bubble`, `pie`, `doughnut`, `polarArea`, `radar`), `data`, `options`, `plugins`, `width`, `height`, `responsive`, `ariaLabel`, `ariaLabelledBy` | `(dataSelect)` |

- `chart.js` is an optional peer dependency: add it in apps that use the chart.
- Pass a new `data` object to update. Put the numbers as text in an element marked `hxChartFallback`.
- Tests: provide `HX_CHART_LOADER` with a fake.

## Validators: `Validators`, `ValidatorKey`, entry point `@gravionlabs/helix-ui/validators`

Reactive form validators; the first argument is the message (string or `(value) => string`).

| `Validators.`                          | Further arguments       | Error key (`ValidatorKey.`)            |
| -------------------------------------- | ----------------------- | -------------------------------------- |
| `required`                             |                         | `Required`                             |
| `email`, `number`, `integer`, `date`   | `allowEmpty`            | `Email`, `Number`, `Integer`, `Date`   |
| `min`, `max`, `minLength`, `maxLength` | limit, `allowEmpty`     | `Min`, `Max`, `MinLength`, `MaxLength` |
| `pattern`                              | `regex`, `allowEmpty`   | `Pattern`                              |
| `oneOf`                                | `options`               | `OneOf`                                |
| `allOf`                                | `options`, `allowEmpty` | `AllOf`                                |

- `allowEmpty` defaults to `true`: add `required` for a mandatory value.
- The error value is the message: `control.errors?.[ValidatorKey.Required]`.
