import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../skills/ng/ng-implementation');
// one source for the config (ADR 0008): the template of setup-oxc-husky
const templateRoot = path.resolve(__dirname, '../../../skills/ts/setup-oxc-husky');
const templatePath = path.join(templateRoot, 'templates/stylelint.config.mjs');
const template = readFileSync(templatePath, 'utf8');
const skill = readFileSync(path.join(root, 'SKILL.md'), 'utf8');
const reference = readFileSync(path.join(root, 'references/style-lint.md'), 'utf8');

describe('ng-implementation stylelint template', () => {
  it('is parseable', () => {
    expect(() => execFileSync(process.execPath, ['--check', templatePath])).not.toThrow();
  });
  it('forbids hex colors, color functions and arbitrary font sizes', () => {
    expect(template).toContain("'color-no-hex'");
    for (const fn of ['rgb', 'rgba', 'hsl', 'hsla']) expect(template).toContain(`'${fn}'`);
    expect(template).toContain("'declaration-property-value-allowed-list'");
    expect(template).toContain("'font-size'");
    expect(template).toContain('postcss-scss');
  });
  it('names the reason and the style guide in every message', () => {
    const messages = template.match(/message/g) ?? [];
    expect(messages).toHaveLength(3);
    expect(template).toContain('docs/STYLEGUIDE.md');
    expect(template.match(/Why:/g)).toHaveLength(3);
  });
  it('keeps the former Biome CSS rules', () => {
    expect(template).toContain("'declaration-block-no-duplicate-properties'");
    expect(template).toContain("'selector-pseudo-element-no-unknown'");
    expect(template).toContain("'ng-deep'");
  });
  it('has no second copy in ng-implementation', () => {
    expect(existsSync(path.join(root, 'templates/stylelint.config.mjs'))).toBe(false);
    expect(reference).toContain('setup-oxc-husky');
  });
  it('allows the token file', () => {
    expect(template).toMatch(/overrides/);
    expect(template).toContain('tokens');
  });

  // Fixture run only where stylelint is installed.
  const stylelintInstalled =
    existsSync(path.resolve(__dirname, '../../../node_modules/stylelint/package.json')) &&
    existsSync(path.resolve(__dirname, '../../../node_modules/stylelint-config-standard-scss'));
  it.runIf(stylelintInstalled)('rejects raw values and accepts tokens', async () => {
    // stylelint is installed in the consumer repository, not here: the module name is a variable so tsc does not resolve it
    const moduleName = 'stylelint';
    const { default: stylelint } = (await import(moduleName)) as {
      default: {
        lint(options: object): Promise<{ results: { warnings: unknown[] }[] }>;
      };
    };
    const config = (await import(templatePath)).default;
    const lint = async (code: string, codeFilename: string) =>
      (await stylelint.lint({ code, codeFilename, config, configBasedir: templateRoot })).results[0]
        .warnings;
    const bad = await lint(
      'a { color: #fff; background: rgb(0 0 0); border-color: hsl(0 0% 0%); font-size: 13px; }\n',
      'a.scss',
    );
    expect(bad.length).toBeGreaterThanOrEqual(4);
    expect(
      await lint('a { color: var(--color-text); font-size: var(--font-size-m); }\n', 'a.scss'),
    ).toEqual([]);
    expect(await lint(':root { --c: #fff; }\n', 'src/styles/tokens.css')).toEqual([]);
  });
});

describe('ng-implementation links the style-lint reference', () => {
  it('links it from SKILL.md and stays within 100 lines', () => {
    expect(skill).toContain('references/style-lint.md');
    expect(skill.split('\n').length).toBeLessThanOrEqual(101);
  });
  it('reference covers install, checks entry and token file', () => {
    expect(reference).toContain('stylelint-config-standard-scss');
    expect(reference).toContain('"checks"');
    expect(reference).toMatch(/Token file/);
  });
});

describe('ng-implementation style-lint Helix branch', () => {
  const section = reference.split('\n## Helix projects\n')[1].split('\n## Install\n')[0];
  const helix = readFileSync(path.join(root, 'references/helix.md'), 'utf8');

  it('selects it by the helix-ui dependency and keeps the procedure for other projects', () => {
    expect(reference).toContain('depends on `@gravionlabs/helix-ui`');
    expect(reference).toContain('Every other project');
    expect(reference).toContain('Copy `stylelint.config.mjs` from the `setup-oxc-husky` templates');
  });
  it('names the package, configs, rule and helper of the preset', () => {
    for (const name of [
      '@gravionlabs/helix-lint',
      '@gravionlabs/helix-lint/stylelint',
      '@gravionlabs/helix-lint/eslint',
      '@angular-eslint/template-parser',
      'helix/no-raw-control',
      'helixAllow({ files, rules, reason })',
    ])
      expect(section).toContain(name);
    expect(section).toContain('empty placeholders');
  });
  it('adds both commands to pnpm lint and the fast checks', () => {
    expect(section).toContain('`pnpm lint` runs both commands');
    const config = JSON.parse(section.split('```json\n')[1].split('```')[0]) as {
      checks: { command: string; fast: boolean }[];
    };
    expect(config.checks.map((check) => check.command)).toEqual([
      'npx --no-install stylelint "**/*.{css,scss}"',
      'npx --no-install eslint "**/*.html"',
    ]);
    expect(config.checks.every((check) => check.fast)).toBe(true);
  });
  it('is linked from references/helix.md', () => {
    expect(helix).toContain('(style-lint.md#helix-projects)');
  });
});
