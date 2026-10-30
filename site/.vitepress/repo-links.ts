import { existsSync, statSync } from 'node:fs';
import { posix, resolve } from 'node:path';

/** Where the repository is, for links to files that are not pages of the site. */
export const REPO_URL = 'https://github.com/GravionLabs/skills';
export const REPO_BRANCH = 'main';

/** Pages whose source is the README at the repository root (embedded as the home page). */
const README_PAGES = new Set(['index.md', 'README.md']);

/** The pages of the site, as paths in the repository: every markdown file under `docs/`. */
export function isSitePage(repoPath: string): boolean {
  return repoPath.startsWith('docs/') && repoPath.endsWith('.md');
}

/** What a link needs to know about the files of the repository; replaced in tests. */
export interface RepoFiles {
  /** `file`, `directory`, or null when there is nothing at that path of the repository. */
  kind(repoPath: string): 'file' | 'directory' | null;
}

/** The files of this repository on disk (`repoRoot` is its top folder). */
export function repoFilesOnDisk(repoRoot: string): RepoFiles {
  return {
    kind(repoPath) {
      const full = resolve(repoRoot, repoPath);
      if (!existsSync(full)) return null;
      return statSync(full).isDirectory() ? 'directory' : 'file';
    },
  };
}

/** Not a path of the repository: another site, an anchor, or an absolute address on this site. */
const EXTERNAL = /^([a-z][a-z0-9+.-]*:|\/|#)/i;

/** The repository path a relative link on page `relativePath` (under `docs`) points to, or null. */
function resolveRepoPath(target: string, relativePath: string): string | null {
  const dir = README_PAGES.has(relativePath) ? '' : posix.join('docs', posix.dirname(relativePath));
  const repoPath = posix.normalize(posix.join(dir, target));
  if (repoPath === '..' || repoPath.startsWith('../')) return null;
  const trimmed = repoPath.replace(/\/$/, '');
  return trimmed === '.' ? '' : trimmed;
}

/**
 * The address a link of a page should have. A link to another page of the site stays a site link
 * (from the README, `docs/usage/x.md` becomes `usage/x.md`). A link to anything else in the
 * repository (packages, AGENTS.md, scripts, ...) becomes a link to GitHub, because the site does
 * not contain it. `relativePath` is the page, relative to the `docs` folder (`usage/x.md`);
 * `index.md` and `README.md` stand for the README at the repository root.
 */
export function repoLink(href: string, relativePath: string, files: RepoFiles): string {
  if (EXTERNAL.test(href)) return href;
  const [target, ...rest] = href.split(/(?=[?#])/);
  if (!target) return href;
  const suffix = rest.join('');
  const repoPath = resolveRepoPath(target, relativePath);
  if (repoPath === null) return href;
  const kind = files.kind(repoPath);
  if (!kind) return href;
  if (isSitePage(repoPath)) {
    return README_PAGES.has(relativePath) ? `${repoPath.slice('docs/'.length)}${suffix}` : href;
  }
  const base = `${REPO_URL}/${kind === 'directory' ? 'tree' : 'blob'}/${REPO_BRANCH}`;
  return `${base}${repoPath ? `/${repoPath}` : ''}${suffix}`;
}

/** The shape of the markdown-it renderer that the plugin needs (what VitePress gives to `config`). */
interface Token {
  type: string;
  children: Token[] | null;
  attrGet(name: string): string | null;
  attrSet(name: string, value: string): void;
}
interface Markdown {
  core: {
    ruler: {
      push(
        name: string,
        rule: (state: { tokens: Token[]; env: { relativePath?: string } }) => void,
      ): void;
    };
  };
}

/** A markdown-it plugin: the links of every page go through {@link repoLink}. */
export function repoLinksPlugin(md: Markdown, files: RepoFiles): void {
  md.core.ruler.push('gravionlabs_repo_links', (state) => {
    const page = state.env.relativePath;
    if (!page) return;
    for (const block of state.tokens) {
      for (const token of block.children ?? []) {
        if (token.type !== 'link_open') continue;
        const href = token.attrGet('href');
        if (href) token.attrSet('href', repoLink(href, page, files));
      }
    }
  });
}
