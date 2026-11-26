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
      'references/migration.md',
      'references/testing.md',
      'references/theming.md',
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
  it('loads the migration reference for migration, lint preset and allowlist', () => {
    const row = skill.split('\n').find((line) => line.includes('`references/migration.md`'));
    for (const word of ['Migrating an app', 'lint preset', 'allowlist'])
      expect(row).toContain(word);
  });
  it('gives each migration step a check and names the lint exports', () => {
    const migration = read(path.join(root, 'references/migration.md'));
    const steps = migration.split(/^## (?=\d\. )/m).slice(1);
    expect(steps).toHaveLength(5);
    for (const step of steps) expect(step, step.split('\n')[0]).toMatch(/^Check: /m);
    const names = [
      '`helixAllow({ files, rules, reason })`',
      '`helix/no-raw-control`',
      '@gravionlabs/helix-lint/eslint',
      '@gravionlabs/helix-lint/stylelint',
    ];
    for (const name of names) expect(migration, name).toContain(name);
    expect(migration).toContain('`references/style-lint.md`');
    expect(migration).not.toContain('pnpm add');
  });
  it('loads the testing reference for tests and links ng-test and the harness issue', () => {
    const row = skill.split('\n').find((line) => line.includes('`references/testing.md`'));
    expect(row).toContain('Tests of Helix-based components');
    const testing = read(path.join(root, 'references/testing.md'));
    expect(testing).toContain('`ng-test`');
    expect(testing).toContain('no component test harnesses and no `testing` entry point');
    expect(testing).toContain('https://github.com/GravionLabs/helix/issues/1226');
  });
  it('selects no element by a Helix class or CSS query in any example', () => {
    const testing = read(path.join(root, 'references/testing.md'));
    const examples = [...testing.matchAll(/```ts\n([\s\S]*?)```/g)].map(([, code]) => code);
    expect(examples.length).toBeGreaterThan(0);
    for (const code of examples)
      expect(code).not.toMatch(/\.hx-|querySelector|By\.css|getElementsByClassName/);
  });
  it('loads the theming reference for colors, sizes, dark mode and density', () => {
    const row = skill.split('\n').find((line) => line.includes('`references/theming.md`'));
    for (const word of ['Colors', 'spacing', 'font sizes', 'dark mode', 'density'])
      expect(row).toContain(word);
  });
  it('names the surface roles of the accepted ADR 0004 and both scales', () => {
    const theming = read(path.join(root, 'references/theming.md'));
    const roles = theming.split('## Surface roles')[1].split('\n## ')[0];
    expect(roles).toMatch(/ADR 0004\]\([^)]+\) of Helix \(Accepted/);
    const names = [
      ...['frame', 'panel', 'card', 'overlay', 'hover'].map((role) => `surface-${role}`),
      'border-panel',
      'border-divider',
    ];
    for (const name of names) expect(roles, name).toContain(`\`--h-${name}\``);
    for (const step of ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl'])
      expect(theming).toContain(`\`--h-font-size-${step}\``);
    for (let step = 1; step <= 8; step++) expect(theming).toContain(`\`--h-space-${step}\``);
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
