# Tokens and theming

Change the look through Helix tokens (`--h-*` CSS custom properties) and the theme service, not through component CSS. Source: [Helix theming](https://github.com/GravionLabs/helix/blob/main/docs/THEMING.md); the names are those of Helix `release/next`, so check an unknown one in the installed `tokens.css`:

```powershell
Select-String -Path node_modules/@gravionlabs/helix-ui/tokens.css -Pattern '--h-surface-card' -SimpleMatch
```

## Surface roles

[ADR 0004](https://github.com/GravionLabs/helix/blob/main/docs/adr/0004-surface-roles-dark-elevation-density-and-named-theme-presets.md) of Helix (Accepted, since GravionLabs/helix#1227) makes these roles the only source of the surfaces. Use a role, not a step of the grey scale.

| Token                 | Used for                              | Light         | Dark          |
| --------------------- | ------------------------------------- | ------------- | ------------- |
| `--h-surface-frame`   | Ground behind the shell               | `surface.50`  | `surface.950` |
| `--h-surface-panel`   | Content panel, nav rail, page         | `surface.0`   | `surface.900` |
| `--h-surface-card`    | Cards, table head, code               | `surface.0`   | `surface.800` |
| `--h-surface-overlay` | Dialog, popover, menu                 | `surface.0`   | `surface.800` |
| `--h-surface-hover`   | Hovered row, menu item, rail link     | `surface.100` | `surface.700` |
| `--h-border-panel`    | Hairline around panels and cards      | `surface.200` | `surface.700` |
| `--h-border-divider`  | Lines inside a panel (rows, dividers) | `surface.100` | `surface.700` |

Dark elevation:

- A raised level is one scale step lighter than what it sits on, plus a hairline: frame, panel, card
- An overlay has the card's step; its hairline and a shadow of 40 % black separate it, so keep both
- A card has a `--h-border-panel` hairline and no shadow in light mode
- The dark hover has the colour of the hairline and the dividers: a divider inside a hovered row is not visible

Dark mode is the class `app-dark` on `<html>`, set by `HxTheme` (`setDark`, `toggleDark`). The roles switch with it, so write no dark rule for them.

## Density

`density` is `comfortable` (default) or `compact`. `compact` sets the root font size to 13 px, so every `rem` token scales, and tightens the shell sizes. The 14 px comfortable root comes from `@gravionlabs/helix-shell/globals.css`.

```ts
provideHxTheme({ density: 'compact', storageKey: 'my-app-theme' });
inject(HxTheme).setDensity('comfortable'); // null: the preset's density
```

Do not set the root font size or smaller paddings in app CSS to get a dense look.

## Type scale and spacing

[ADR 0009](https://github.com/GravionLabs/helix/blob/main/docs/adr/0009-type-scale-spacing-form-field-list-row-and-lint-preset.md) of Helix (Accepted). Both scales are in `rem` and are the same in light and dark.

| Type token          | Value    | 14 px root | 13 px root |
| ------------------- | -------- | ---------- | ---------- |
| `--h-font-size-xs`  | 0.75rem  | 10.5 px    | 9.75 px    |
| `--h-font-size-sm`  | 0.875rem | 12.25 px   | 11.375 px  |
| `--h-font-size-md`  | 1rem     | 14 px      | 13 px      |
| `--h-font-size-lg`  | 1.125rem | 15.75 px   | 14.625 px  |
| `--h-font-size-xl`  | 1.25rem  | 17.5 px    | 16.25 px   |
| `--h-font-size-2xl` | 1.5rem   | 21 px      | 19.5 px    |
| `--h-font-size-3xl` | 2rem     | 28 px      | 26 px      |

| Spacing token | Value   | 14 px root | 13 px root |
| ------------- | ------- | ---------- | ---------- |
| `--h-space-1` | 0.25rem | 3.5 px     | 3.25 px    |
| `--h-space-2` | 0.5rem  | 7 px       | 6.5 px     |
| `--h-space-3` | 0.75rem | 10.5 px    | 9.75 px    |
| `--h-space-4` | 1rem    | 14 px      | 13 px      |
| `--h-space-5` | 1.25rem | 17.5 px    | 16.25 px   |
| `--h-space-6` | 1.5rem  | 21 px      | 19.5 px    |
| `--h-space-7` | 1.75rem | 24.5 px    | 22.75 px   |
| `--h-space-8` | 2rem    | 28 px      | 26 px      |

## Theme presets

A preset is a name for a primary colour, a surface scale and a density. Bundled: `helix` (default), `vitepress` and `compact` (`helix` with compact density).

```ts
// app.config.ts: pick a preset, or define one of the app next to the bundled ones
provideHxTheme({
  presets: { forest: { primary: 'emerald', surface: 'stone', density: 'compact' } },
  preset: 'forest',
  storageKey: 'my-app-theme',
});

// at runtime
inject(HxTheme).setPreset('vitepress');
```

- The user's own choices win: `primary`, `surface` and `density` in the options, a remembered choice, `setPrimary()`, `setSurface()`, `setDensity()`
- `setPreset()` drops the choices made so far
- An unknown name throws; `presetNames` lists the valid ones

## Replacing hard-coded values

| Hard-coded                        | Replace with                                                         |
| --------------------------------- | -------------------------------------------------------------------- |
| `font-size` in px or rem          | `var(--h-font-size-*)`: the step nearest at the 14 px root           |
| `padding`, `margin`, `gap` in px  | `var(--h-space-*)`: the step nearest at the 14 px root               |
| Page, panel, card, popup colour   | The surface role of that level                                       |
| Hover background                  | `var(--h-surface-hover)`                                             |
| Border or line colour             | `var(--h-border-panel)` or `var(--h-border-divider)`                 |
| Text colour, secondary text       | `var(--h-text-color)`, `var(--h-text-muted-color)`                   |
| Accent, text on the accent        | `var(--h-primary-color)`, `var(--h-primary-contrast-color)`          |
| Radius                            | `var(--h-border-radius-md)` (6 px, panels and cards)                 |
| Status colour (error, success, …) | The `severity` input of a component ([components.md](components.md)) |

```css
.entry-title {
  font-size: var(--h-font-size-sm); /* was 12px */
  color: var(--h-text-muted-color); /* was #67676c */
  padding: var(--h-space-2) var(--h-space-3); /* was 7px 10px */
  border-bottom: 1px solid var(--h-border-divider); /* was rgb(235, 235, 239) */
}
```

- Replace by meaning, not by the closest colour: a token switches with dark mode, the matched hex does not
- Widths, heights and icon sizes are dimensions: the spacing scale is not for them

## Overriding a token

Only when no role, scale step or preset gives the look. Load after `tokens.css`; `:root:root` wins over it in any load order.

```css
:root:root {
  --h-button-border-radius: 999px;
}
:root:root.app-dark {
  --h-form-field-border-color: var(--h-surface-600);
}
```

- To use the app's own design tokens, point semantic roles at them (`--h-primary-color`, `--h-text-color`, `--h-content-background`, `--h-content-border-color`), with a rule for light and one for `.app-dark`
- Define raw values only in that file; the lint preset allows it with a `helixAllow` entry ([migration.md](migration.md))
