import * as fs from 'fs';
import * as path from 'path';

const packages = path.resolve(__dirname, '../../../skills');
const read = (rel: string) => fs.readFileSync(path.join(packages, rel), 'utf-8');
const json = (rel: string) => JSON.parse(read(rel));
const skill = 'ts/setup-oxc-husky';

describe('oxc setup (ADR 0006, #770)', () => {
  it('the formatter template matches the hub conventions', () => {
    expect(json(`${skill}/templates/.oxfmtrc.json.template`)).toMatchObject({
      printWidth: 100,
      tabWidth: 2,
      useTabs: false,
      singleQuote: true,
      semi: true,
      trailingComma: 'all',
      endOfLine: 'lf',
    });
  });

  it('both lint templates are type-aware; Angular loads the angular-eslint JS plugin', () => {
    for (const v of ['plain-ts', 'angular'])
      expect(json(`${skill}/templates/${v}/.oxlintrc.json.template`).options.typeAware).toBe(true);
    const ng = json(`${skill}/templates/angular/.oxlintrc.json.template`);
    expect(ng.jsPlugins).toEqual(['@angular-eslint/eslint-plugin']);
    expect(ng.rules['@angular-eslint/component-max-inline-declarations']).toEqual([
      'error',
      { template: 0 },
    ]);
    expect(ng.ignorePatterns).toContain('lint-probe/**');
  });

  it('ESLint lints Angular templates only, without processInlineTemplates', () => {
    const cfg = read(`${skill}/templates/angular/eslint.config.mjs`);
    expect(cfg).toContain("files: ['**/*.html']");
    expect(cfg).not.toMatch(/files: \['\*\*\/\*\.ts'\]|processor:/);
  });

  it('every probe rule is broken in the probe files and expected by the check', () => {
    const check = read(`${skill}/templates/angular/lint-probe/check.mjs`);
    const probe = read(`${skill}/templates/angular/lint-probe/probe.ts`);
    const marked = [...probe.matchAll(/\/\/ probe: ([\w-]+)/g)].map((m) => m[1]);
    expect(marked.length).toBeGreaterThanOrEqual(5);
    for (const rule of marked) expect(check).toContain(`'${rule}'`);
    for (const rule of ['alt-text', 'banana-in-box']) expect(check).toContain(`'${rule}'`);
  });

  it('the script pins the oxc versions exactly and keeps existing configs', () => {
    const s = read(`${skill}/scripts/Setup-Oxc.ps1`);
    expect(s).toMatch(
      /'oxlint' = '\d+\.\d+\.\d+'; 'oxfmt' = '\d+\.\d+\.\d+'; 'oxlint-tsgolint' = '[\d.]+'/,
    );
    expect(s).toContain('--save-exact');
    expect(s).toContain('exists, kept.');
    expect(s).toContain('node lint-probe/check.mjs');
  });

  it('the old setup skills are gone and the create-project skills point to setup-oxc-husky', () => {
    expect(fs.existsSync(path.join(packages, 'ts/setup-biome-husky'))).toBe(false);
    expect(fs.existsSync(path.join(packages, 'ts/setup-prettier-eslint-husky'))).toBe(false);
    expect(read('ts/ts-create-project/SKILL.md')).toContain('`setup-oxc-husky`');
    expect(read('ng/ng-create-project/SKILL.md')).toContain('`setup-oxc-husky`');
    expect(read('ng/ng-create-project/scripts/New-AngularProject.ps1')).toContain(
      'setup-oxc-husky/scripts/Setup-Oxc.ps1',
    );
    expect(read('ts/ts-implementation/SKILL.md')).toContain('`setup-oxc-husky`');
    expect(read('ng/ng-implementation/SKILL.md')).toContain('`setup-oxc-husky`');
  });
});
