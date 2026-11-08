import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatedPages, sidebar } from '../.vitepress/sidebar';

const site = resolve(import.meta.dirname, '..');

/** Not pages: the `srcExclude` of the config, plus the VitePress folder. */
const notPages = new Set(['/README.md', '/tests', '/node_modules', '/.vitepress']);

/** Every markdown page below site/ as a site link (`/concepts/skills`). */
function pagesOnDisk(dir = site, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    notPages.has(`${prefix}/${e.name}`)
      ? []
      : e.isDirectory()
        ? pagesOnDisk(resolve(dir, e.name), `${prefix}/${e.name}`)
        : e.name.endsWith('.md')
          ? [`${prefix}/${e.name.replace(/\.md$/, '')}`]
          : [],
  );
}

const listed = sidebar.flatMap((g) => g.items.map((i) => i.link));

/** `site/index.md`: the home page (the README), reached by the site title, not the sidebar. */
const homePage = '/index';

describe('the sidebar of the docs site', () => {
  it('has the groups in the order Start here, Guides, Configuration, Concepts, Reference, Contributing', () => {
    expect(sidebar.map((g) => g.text)).toEqual([
      'Start here',
      'Guides',
      'Configuration',
      'Concepts',
      'Reference',
      'Contributing',
    ]);
  });

  it('puts the quick start in Start here right after the overview', () => {
    const start = sidebar.find((g) => g.text === 'Start here');
    const links = start?.items.map((i) => i.link) ?? [];
    expect(links.indexOf('/quick-start')).toBe(links.indexOf('/overview') + 1);
  });

  it('lists every existing docs page in some group, except the home page', () => {
    expect(pagesOnDisk().filter((p) => p !== homePage && !listed.includes(p))).toEqual([]);
  });

  it('lists no ADR or spike: they stay internal in docs/', () => {
    expect(listed.filter((l) => /^\/(adr|spikes)\//.test(l))).toEqual([]);
    expect(pagesOnDisk().filter((p) => /^\/(adr|spikes)\//.test(p))).toEqual([]);
  });

  it('does not list the home page', () => {
    expect(pagesOnDisk()).toContain(homePage);
    expect(listed).not.toContain(homePage);
    expect(listed).not.toContain('/');
  });

  it('lists only pages that exist, except the CI-generated ones', () => {
    const missing = listed
      .filter((l) => !generatedPages.includes(l))
      .filter((l) => !existsSync(resolve(site, `${l.slice(1)}.md`)));
    expect(missing).toEqual([]);
  });

  it('lists the generated pages and the troubleshooting page in the Reference group', () => {
    const reference = sidebar.find((g) => g.text === 'Reference');
    expect(reference?.items.map((i) => i.link)).toEqual([
      ...generatedPages,
      '/reference/troubleshooting',
    ]);
  });

  it('has no page twice and no empty group', () => {
    expect(new Set(listed).size).toBe(listed.length);
    for (const g of sidebar) expect(g.items.length).toBeGreaterThan(0);
  });

  it('uses site links without extension', () => {
    for (const l of listed) expect(l).toMatch(/^\/[A-Za-z0-9-]+(\/[A-Za-z0-9-]+)*$/);
  });
});
