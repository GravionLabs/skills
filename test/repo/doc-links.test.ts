import * as fs from 'fs';
import * as path from 'path';

// #1083: the VitePress build fails on a dead page link, but not on a link to a removed section, and it
// does not see the links of the skills to the published site. This checks both.
const root = path.resolve(__dirname, '../..');
const SITE_URL = 'https://gravionlabs.github.io/skills/';
const GENERATED = new Set(['site/skill-list.md']);

function markdownFiles(dir: string): string[] {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const file = `${dir}/${entry.name}`;
    if (['node_modules', '.vitepress'].includes(entry.name)) return [];
    if (entry.isDirectory()) return markdownFiles(file);
    return entry.name.endsWith('.md') ? [file] : [];
  });
}

/** The lines of a markdown text outside fenced code blocks. */
function prose(text: string): string[] {
  let fence = '';
  return text.split('\n').filter((line) => {
    const mark = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (!fence) {
      if (mark) fence = mark;
      return !mark;
    }
    if (mark?.startsWith(fence)) fence = '';
    return false;
  });
}

/** The anchor VitePress gives a heading (`slugify` of @mdit-vue/shared). */
function slugify(heading: string): string {
  return heading
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[\s~!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^(\d)/, '_$1')
    .toLowerCase();
}

function anchors(text: string): Set<string> {
  const found = new Set<string>();
  for (const line of prose(text)) {
    const heading = /^#{1,6}\s+(.*?)\s*$/.exec(line)?.[1];
    if (!heading) continue;
    const slug = slugify(heading);
    let unique = slug;
    for (let i = 1; found.has(unique); i++) unique = `${slug}-${i}`;
    found.add(unique);
  }
  return found;
}

/** The page file and anchor a link of `file` points to, or null when it is no link to a site page. */
function pageTarget(file: string, href: string): { page: string; anchor?: string } | null {
  const [target = '', anchor] = href.split('#', 2);
  if (href.startsWith(SITE_URL)) {
    const route = target.slice(SITE_URL.length).replace(/\.html$/, '');
    const page = `site/${route === '' || route.endsWith('/') ? `${route}index` : route}.md`;
    return { page, anchor };
  }
  if (/^([a-z][a-z0-9+.-]*:|\/)/i.test(href) || !file.startsWith('site/')) return null;
  if (!target) return { page: file, anchor };
  if (!target.endsWith('.md')) return null;
  const page = path.posix.join(path.posix.dirname(file), target);
  return page.startsWith('site/') ? { page, anchor } : null;
}

function brokenLinks(file: string, text: string, read: (page: string) => string | null): string[] {
  const hrefs = prose(text).flatMap((line) => [
    ...[...line.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1] as string),
    ...[...line.matchAll(/<(https:\/\/[^>\s]+)>/g)].map((m) => m[1] as string),
  ]);
  return hrefs.flatMap((href) => {
    const link = pageTarget(file, href);
    if (!link || GENERATED.has(link.page)) return [];
    const page = read(link.page);
    if (page === null) return [`${file}: ${href} (no page ${link.page})`];
    if (link.anchor && !anchors(page).has(link.anchor))
      return [`${file}: ${href} (no section #${link.anchor} in ${link.page})`];
    return [];
  });
}

const readRepo = (file: string): string | null => {
  const full = path.join(root, file);
  return fs.existsSync(full) ? fs.readFileSync(full, 'utf8') : null;
};

describe('links to the documentation site (#1083)', () => {
  const files = ['README.md', ...['site', 'skills', 'docs/agents-md-refs'].flatMap(markdownFiles)];

  it('no page, skill or reference links a removed page or section', () => {
    expect(files.flatMap((f) => brokenLinks(f, readRepo(f) as string, readRepo))).toEqual([]);
  });

  it('reports a removed section and a removed page, for site links and published URLs', () => {
    const pages: Record<string, string> = {
      'site/a.md': '# A\n\n## 1. Cut `release/next`\n\n```\n## Not a heading\n```\n',
    };
    const read = (p: string) => pages[p] ?? null;
    const check = (file: string, text: string) => brokenLinks(file, text, read);

    expect(check('site/b/c.md', '[ok](../a.md#_1-cut-release-next)')).toEqual([]);
    expect(check('site/b/c.md', '[x](../a.md#not-a-heading)')).toHaveLength(1);
    expect(check('site/b/c.md', '[x](gone.md)')).toHaveLength(1);
    expect(check('skills/x/SKILL.md', `[x](${SITE_URL}a#removed)`)).toHaveLength(1);
    expect(check('skills/x/SKILL.md', `<${SITE_URL}gone>`)).toHaveLength(1);
  });

  it('the overview page is linked from the skills and references that own the delivery', () => {
    for (const file of [
      'skills/delivery/deliver/SKILL.md',
      'skills/delivery/retro/SKILL.md',
      'skills/github/github-issue/references/milestones.md',
      'skills/github/github-issue/references/objectives.md',
    ])
      expect(readRepo(file), file).toContain(`${SITE_URL}delivery/model`);
  });
});
