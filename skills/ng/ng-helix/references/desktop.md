# Helix desktop

The frame of a desktop or Tauri app, from `docs/HELIX-DESKTOP.md` and the public APIs of Helix `release/next`. Build the toolbar, activity bar and status bar from these; do not hand-build them.

- Check the package: `npm ls @gravionlabs/helix-desktop`. Peers: `@angular/cdk`, `@gravionlabs/helix-ui`.
- Styles, once and globally: `@gravionlabs/helix-ui/tokens.css`, then `@gravionlabs/helix-desktop/styles.css`.
- `@gravionlabs/helix-desktop` imports nothing from `@tauri-apps/*`. Tauri bindings come from `@gravionlabs/helix-desktop/tauri`; `@tauri-apps/api`, `plugin-updater` and `plugin-process` are optional peers, install them in a Tauri app.
- Helix exports no window controls and no title bar component. `HxAppToolbar` is a drag region only: keep the native title bar and its buttons, or ask before building your own.

## Shell: `@gravionlabs/helix-desktop`

| Selector          | Class           | Inputs (`[(x)]` two-way)                                                                                                        | Outputs, slots                                                                                  |
| ----------------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `hx-app-shell`    | `HxAppShell`    | `[(sidebarWidth)]`, `[(collapsed)]`, `[(activeId)]`, `minWidth`, `maxWidth`, `fixedWidth`, `[(bottomOpen)]`, `[(bottomHeight)]` | `(sidebarChange)`; slots `toolbar`, `activity`, `sidebar`, `panel`, `bottom`, `status`, default |
| `hx-app-toolbar`  | `HxAppToolbar`  | `windowButtonsInset` (room for the macOS window buttons)                                                                        | slots `start`, `centre`, `end`                                                                  |
| `hx-activity-bar` | `HxActivityBar` | `items`, `activeId`, `expanded`, `label`                                                                                        | `(selected)` (the id)                                                                           |
| `hx-mobile-shell` | `HxMobileShell` | `items`, `[(activeId)]`, `[(drawerOpen)]`, `heading`, `menuLabel`, `closeLabel`, `barLabel`                                     | slots `drawer`, `end`, default                                                                  |
| `hx-bottom-bar`   | `HxBottomBar`   | `items` (first five), `activeId`, `label`                                                                                       | `(selected)`                                                                                    |

- `HxAppShell` methods: `selectView(id)` (the active view again collapses the sidebar), `showView(id)` (never collapses), `toggleBottom()`. The app puts the view of `activeId` into the sidebar; the default slot takes its own tab layout.
- `HxMobileShell.chooseView(id)` activates a view and closes the drawer.
- `HelixView` (interface): `id`, `label`, `icon` (`TemplateRef` or icon class name), `placement` (`sidebar`, `tab`), `position` (`top`, `bottom`). Activity and bottom bar items take `id`, `label`, `icon`, `position`, plus `kind` (`view`, `action`) and `badge`.
- `getHxPlatform()` reads `data-platform` of the root element (`web` when absent), `setHxPlatform(p)` sets it before the first render. Pick the shell by platform, not by width: `getHxPlatformKind(getHxPlatform()) === 'mobile'` takes `hx-mobile-shell`.

## Status bar: `@gravionlabs/helix-desktop`

| Selector            | Class                         | Inputs (`[(x)]` two-way)                                                                                                                  | Outputs     |
| ------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| `hx-status-bar`     | `HxStatusBar`                 | none; items take `slot="start"` or `slot="end"`                                                                                           |             |
| `hx-status-item`    | `HxStatusItem`                | `kind` (`text`, `button`), `title`, `ariaLabel`, `disabled`, `tone` (`neutral`, `warn`, `error`, `accent`), `announce`, `[(popoverOpen)]` | `(pressed)` |
| `[hxStatusPopover]` | `HxStatusPopover` (directive) | none; content of the popover of a `kind="button"` item                                                                                    |             |
| `hx-status-version` | `HxStatusVersion`             | `version` (required), `channel` (badge)                                                                                                   |             |
| `hx-status-zoom`    | `HxStatusZoom`                | `[(value)]` (percent), `min`, `max`, `step`, `reset`                                                                                      |             |

- Several conditional items need one root with the slot: `<ng-container ngProjectAs="[slot=end]">` inside the `@if`.

## Tauri: `@gravionlabs/helix-desktop/tauri`

- `providePlatform()` sets `data-platform` at startup. `isTauri()` is true inside a Tauri webview.
- `provideHxAppInfo({ version, channel? })`; a `-rc` version gives channel `rc`. `readTauriVersion()` reads the version, with a fallback outside Tauri.
- `HxUpdateService`: `state()` (`idle`, `checking`, `current`, `available`, `installing`, `error`), `start()` (one check, none on an RC build), `check({ manual: true })`, `installAndRestart()`. The app calls `start()`.
- `HX_UPDATE_BACKEND`: defaults to `tauriUpdateBackend()` in Tauri and `noopUpdateBackend` outside; provide it to replace the plugin calls in tests.
- `HxStatusUpdate` (`<hx-status-update />`): the update state with "Install and restart" in a popover. Hidden on mobile, and while idle or current unless `alwaysVisible`.
- `HxStatusAppVersion` (`<hx-status-app-version />`): version and RC badge from `provideHxAppInfo()`.

## Recipe: app shell with activity bar, version and update item

```ts
// main.ts
import { bootstrapApplication } from '@angular/platform-browser';
import {
  provideHxAppInfo,
  providePlatform,
  readTauriVersion,
} from '@gravionlabs/helix-desktop/tauri';
import { App } from './app/app';

readTauriVersion('0.0.0').then((version) =>
  bootstrapApplication(App, { providers: [providePlatform(), provideHxAppInfo({ version })] }),
);
```

```ts
// app/app.ts
import { Component, inject, signal } from '@angular/core';
import {
  HxActivityBar,
  type HxActivityBarItem,
  HxAppShell,
  HxStatusBar,
} from '@gravionlabs/helix-desktop';
import {
  HxStatusAppVersion,
  HxStatusUpdate,
  HxUpdateService,
} from '@gravionlabs/helix-desktop/tauri';

@Component({
  selector: 'app-root',
  imports: [HxAppShell, HxActivityBar, HxStatusBar, HxStatusAppVersion, HxStatusUpdate],
  templateUrl: './app.html',
})
export class App {
  readonly viewId = signal<string | null>('files');
  readonly items: readonly HxActivityBarItem[] = [
    { id: 'files', label: 'Files', icon: 'icon-files', position: 'top' },
    { id: 'settings', label: 'Settings', icon: 'icon-settings', position: 'bottom' },
  ];

  constructor() {
    void inject(HxUpdateService).start();
  }
}
```

```html
<!-- app/app.html -->
<hx-app-shell #shell [(activeId)]="viewId">
  <hx-activity-bar
    slot="activity"
    [items]="items"
    [activeId]="shell.activeId()"
    [expanded]="!shell.collapsed()"
    (selected)="shell.selectView($event)"
  />
  <nav slot="sidebar"><!-- the view of viewId() --></nav>
  <main><!-- content --></main>
  <hx-status-bar slot="status">
    <hx-status-update slot="end" />
    <hx-status-app-version slot="end" />
  </hx-status-bar>
</hx-app-shell>
```
