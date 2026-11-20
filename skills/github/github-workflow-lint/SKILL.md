---
name: github-workflow-lint
description: 'Lint .github/workflows/ locally with actionlint and zizmor: broken expressions, wrong reusable-workflow inputs, security issues. Use for "lint the workflows", "check GitHub Actions", before pushing a workflow change.'
---

Runs `actionlint` and `zizmor` (offline) on `.github/workflows/` so a workflow error fails locally before CI minutes are spent. Prerequisites: `actionlint` 1.7.12, `zizmor` 1.32.0 and `shellcheck` on the PATH (actionlint checks the `run:` scripts with it).

## Run

```powershell
pwsh scripts/Invoke-WorkflowLint.ps1 [-Path <repo root>]
```

- No `.github/workflows/`: prints `skipped: no workflows`, exit 0.
- Prints the findings only, nothing on success. Exit 1 when either tool finds something.
- A missing tool: exit 2 with the install hint on stderr.
- zizmor runs offline (`--offline`, no `GH_TOKEN`), so online-only audits are skipped. SARIF upload is not used (needs a public repository or GHAS).

## Policy

`templates/zizmor.yml` (copy to `.github/zizmor.yml`; without a repository file the script uses it as is): `unpinned-uses` allows `GravionLabs/ci/*` pinned to a ref (`@v1`), every other action must be pinned to a commit SHA.

## Gate wiring

In a repository with workflows add a fast check to `.agents/config.json`, run by the gate before the tests:

```json
{
  "checks": [
    {
      "name": "workflow-lint",
      "run": "pwsh <skill-dir>/scripts/Invoke-WorkflowLint.ps1",
      "fast": true
    }
  ]
}
```

Only repositories with workflows need it.

## A finding

Fix it. Only when it is a false positive or accepted, record it with a reason: inline `# zizmor: ignore[<rule>] <reason>` (zizmor) or `.github/actionlint.yaml` (actionlint); the reason is required. Details: `references/workflow-lint.md`.
