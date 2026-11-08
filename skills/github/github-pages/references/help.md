# /github-pages

## Usage

```
/github-pages init [--package-manager npm|pnpm]
/github-pages help
```

Sets the repository up for a public GitHub Pages site in `site/` (VitePress), built and deployed by `GravionLabs/ci/.github/workflows/vitepress-pages.yml@v1`.

## Arguments and flags

- `init`: copies the templates (`site/`, `.github/workflows/pages.yml`) without overwriting, sets the Pages source to "GitHub Actions". `pwsh scripts/Initialize-GithubPages.ps1 -DryRun` only reports.
- `--package-manager npm|pnpm`: the manager of the workflow and of `site/`; default `pnpm` with a `pnpm-lock.yaml`, else `npm`.
- Rule: `site/` is the only Pages source. `docs/` (ADRs, internal planning specs) is never published, at most linked. Include repository files at build time with `<!--@include: ../../SPEC.md-->`, do not copy them.
- Output: one line per file (`created`, `skipped`), then `pages source: workflow (set|unchanged)`.

## Examples

```
/github-pages init
/github-pages init --package-manager pnpm
```

## Config

- Workflow inputs (`.github/workflows/pages.yml`): `site-path` (default `site`), `package-manager`, `pre-build`, `deploy` (default `true`).
- `SITE_BASE` sets the VitePress `base` (the workflow sets `/<repository>/`), default `/`.

## See also

- `github-release`, `github-pull-request`
