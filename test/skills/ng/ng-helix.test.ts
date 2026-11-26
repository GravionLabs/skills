import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ng = path.resolve(__dirname, '../../../skills/ng');
const root = path.join(ng, 'ng-helix');
const read = (file: string) => readFileSync(file, 'utf8');
const skill = read(path.join(root, 'SKILL.md'));
const references = readdirSync(path.join(root, 'references')).map((name) =>
  read(path.join(root, 'references', name)),
);
const helix = read(path.join(ng, 'ng-implementation/references/helix.md'));

describe('ng-helix skill', () => {
  it('has the reference files of its table', () => {
    const files = [...skill.matchAll(/^\|[^|]+\| `(references\/[^`]+)`/gm)].map(([, f]) => f);
    expect(files).toEqual([
      'references/components.md',
      'references/recipes.md',
      'references/desktop.md',
    ]);
    for (const file of files) expect(existsSync(path.join(root, file)), file).toBe(true);
  });
  it('loads the desktop reference for shell, status bar, Tauri and updates', () => {
    const row = skill.split('\n').find((line) => line.includes('`references/desktop.md`'));
    for (const word of ['app shell', 'status bar', 'Tauri', 'updates']) expect(row).toContain(word);
  });
  it('names the desktop exports and invents no window controls', () => {
    const desktop = read(path.join(root, 'references/desktop.md'));
    const names = [
      'HxAppShell HxAppToolbar HxActivityBar HxMobileShell HxBottomBar HxStatusBar HxStatusItem',
      'HxStatusPopover HxStatusVersion HxStatusZoom HelixView getHxPlatform setHxPlatform',
      'HxUpdateService HX_UPDATE_BACKEND tauriUpdateBackend HxStatusUpdate HxStatusAppVersion',
      'provideHxAppInfo providePlatform isTauri',
    ]
      .join(' ')
      .split(' ');
    for (const name of names) expect(desktop, name).toContain(name);
    expect(desktop).toContain('no window controls and no title bar');
  });
  it('links the UX rules and the style guide of the project', () => {
    expect(skill).toContain('https://github.com/GravionLabs/helix/blob/main/docs/UX-RULES.md');
    expect(skill).toContain('`docs/STYLEGUIDE.md`');
  });
  it('copies no rule text of the Helix reference', () => {
    const rules = helix
      .split('## Rule')[1]
      .split('## Mapping')[0]
      .split('\n')
      .filter((line) => line.startsWith('- '))
      .map((line) => line.slice(2));
    expect(rules).toHaveLength(2);
    for (const rule of rules)
      for (const text of [skill, ...references]) expect(text).not.toContain(rule);
  });
  it('is linked from the Helix reference of ng-implementation', () => {
    expect(helix.split('## See also')[1]).toContain('`ng-helix`');
  });
});
