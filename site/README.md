# site

The GravionLabs skills documentation site, built with [VitePress](https://vitepress.dev). `site/` is the
Pages source: every markdown file in it is a page (`srcDir` is `.`), except this README, `tests/` and
`node_modules/` (`srcExclude`). `docs/` is internal (ADRs, spikes) and not published; a page that links
there gets a GitHub URL.

## Home page

The home page (`/`) is `site/index.md`, a VitePress `layout: home` page: a hero with three actions
(overview, skills, GitHub) and a row of feature cards, all in its frontmatter. It has no body and
`editLink: false`. The README at the repository root is the GitHub landing page and is not part of
the site; the repo-links plugin still treats `README.md` like `index.md` when a page links to files
outside `site/`.

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

The sidebar is the list in `.vitepress/sidebar.ts`; a test fails when a `site/**/*.md` page is in
no group.
