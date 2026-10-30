# site

The GravionLabs skills documentation site, built with [VitePress](https://vitepress.dev). It has no content of
its own: `srcDir` is `../docs`, so every page is a file of `docs/`, rendered in place. Keep `.md`
files out of `site/` (this README is the only one).

## Home page

The home page (`/`) is `docs/index.md`, a VitePress `layout: home` page: a hero with three actions
(overview, skills, GitHub) and a row of feature cards, all in its frontmatter. It has no body and
`editLink: false`. The README at the repository root is the GitHub landing page and is not part of
the site; the repo-links plugin still treats `README.md` like `index.md` when a page links to files
outside `docs/`.

## Commands

```powershell
pnpm install
pnpm --filter site dev       # live preview at http://localhost:5173
pnpm --filter site build     # static build to site/.vitepress/dist; a dead link fails it
pnpm --filter site preview   # serve the build
pnpm --filter site test      # sidebar, repo-links and config tests
```

`SITE_BASE` sets the base path (default `/`); the GitHub Pages workflow sets `/skills/`:

```powershell
$env:SITE_BASE = '/skills/'; pnpm --filter site build
```

The sidebar is the list in `.vitepress/sidebar.ts`; a test fails when a `docs/**/*.md` page is in
no group.
