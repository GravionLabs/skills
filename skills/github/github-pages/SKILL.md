---
name: github-pages
description: 'Set a repository up for a public GitHub Pages site in site/ (VitePress, built and deployed by the reusable workflow of GravionLabs/ci). Use for "/github-pages init", "publish a site", "set up GitHub Pages".'
---

Sets up `site/` as the only GitHub Pages source. Prerequisites: `gh` authenticated with admin rights on the repository, repo root, Node.js.

`help` (or `--help`, `-h`): print `references/help.md` unchanged, nothing else.

Usage: `/github-pages init [--package-manager npm|pnpm]` (default: `pnpm` when a `pnpm-lock.yaml` exists, else `npm`).

## The rule: site/ is published, docs/ is not

- `site/` is the only Pages source. `docs/` (ADRs, internal planning specs) is never published: nothing from `docs/adr` or internal specs is copied into `site/`, at most linked.
- Repository files that belong on the site are included at build time, never copied: `<!--@include: ../../SPEC.md-->` in a page of `site/` (path relative to the page).
- Dead links fail the build (`ignoreDeadLinks: false`).

## init

1. Show what will happen first:

```powershell
pwsh scripts/Initialize-GithubPages.ps1 -DryRun [-PackageManager pnpm]
```

2. After approval run it without `-DryRun`. The script:
   - copies `templates/site/` to `site/`: `package.json` (vitepress, vitest; scripts `dev`, `build`, `test`), `.vitepress/config.mts` (`base` from `SITE_BASE`, default `/`), `.vitepress/theme/`, `index.md`, `tests/` (config test);
   - copies `templates/workflows/pages.yml` to `.github/workflows/pages.yml` (calls `GravionLabs/ci/.github/workflows/vitepress-pages.yml@v1`, inputs `site-path`, `package-manager`, `pre-build`, `deploy`);
   - sets the Pages source to "GitHub Actions" (`POST repos/{owner}/{repo}/pages -f build_type=workflow`, `PUT` when Pages exists) and prints `pages source: workflow (set|unchanged)`.
3. Existing files are never overwritten (each is reported `skipped`); a present `site/` is reported and skipped as a whole. Re-running is safe.
4. Tell the user: install the site dependencies (`cd site && npm install` or `pnpm install`), run `npm test` and `npm run build` in `site/`, then commit.

## Out of scope

Moving an existing `docs/` to `site/` is not done here; ask first and keep ADRs and planning specs out of `site/`.

Deploy switch: the `deploy` input of the workflow (default `true`); set `deploy: false` in `pages.yml` to build without publishing. No repository variable.
