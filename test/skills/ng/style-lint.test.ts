import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../skills/ng/ng-implementation');
const templatePath = path.join(root, 'templates/stylelint.config.mjs');
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
  it('allows the token file', () => {
    expect(template).toMatch(/overrides/);
    expect(template).toContain('tokens');
  });

  // Fixture run only where stylelint is installed.
  const stylelintInstalled =
    existsSync(path.resolve(__dirname, '../../../node_modules/stylelint/package.json')) &&
    existsSync(path.resolve(__dirname, '../../../node_modules/stylelint-config-standard-scss'));
  it.runIf(stylelintInstalled)('rejects raw values and accepts tokens', async () => {
    const { default: stylelint } = await import('stylelint');
    const config = (await import(templatePath)).default;
    const lint = async (code: string, codeFilename: string) =>
      (await stylelint.lint({ code, codeFilename, config, configBasedir: root })).results[0]
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
