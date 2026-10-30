import { existsSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { generatedPages, sidebar } from '../.vitepress/sidebar';

const docs = resolve(import.meta.dirname, '../../docs');

/** Every markdown page below docs/ as a site link (`/concepts/skills`). */
function pagesOnDisk(dir = docs, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? pagesOnDisk(resolve(dir, e.name), `${prefix}/${e.name}`)
      : e.name.endsWith('.md')
        ? [`${prefix}/${e.name.replace(/\.md$/, '')}`]
        : [],
  );
}

const listed = sidebar.flatMap((g) => g.items.map((i) => i.link));

/** `docs/index.md`: the home page (the README), reached by the site title, not the sidebar. */
const homePage = '/index';

describe('the sidebar of the docs site', () => {
  it('lists every existing docs page in some group, except the home page', () => {
    expect(pagesOnDisk().filter((p) => p !== homePage && !listed.includes(p))).toEqual([]);
  });

  it('does not list the home page', () => {
    expect(pagesOnDisk()).toContain(homePage);
    expect(listed).not.toContain(homePage);
    expect(listed).not.toContain('/');
  });

  it('lists only pages that exist, except the CI-generated ones', () => {
    const missing = listed
      .filter((l) => !generatedPages.includes(l))
      .filter((l) => !existsSync(resolve(docs, `${l.slice(1)}.md`)));
    expect(missing).toEqual([]);
  });

  it('lists the four generated pages in the Reference group', () => {
    const reference = sidebar.find((g) => g.text === 'Reference');
    expect(reference?.items.map((i) => i.link)).toEqual(generatedPages);
  });

  it('has no page twice and no empty group', () => {
    expect(new Set(listed).size).toBe(listed.length);
    for (const g of sidebar) expect(g.items.length).toBeGreaterThan(0);
  });

  it('uses site links without extension', () => {
    for (const l of listed) expect(l).toMatch(/^\/[A-Za-z0-9-]+(\/[A-Za-z0-9-]+)*$/);
  });
});
