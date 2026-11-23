---
name: secret-scan
description: 'Scan a repository for committed secrets with gitleaks in the gate and in CI, with a reasoned allowlist. Use for "scan for secrets", "add gitleaks", "allowlist a finding".'
---

Agents copy tokens from logs, `.env` files and command output into code, tests and docs. Every repository scans for secrets with the `gitleaks` CLI in its gate and in CI. Paths are relative to this skill's directory.

## Setup

1. Copy `templates/.gitleaks.toml` to the repository root (`[extend] useDefault = true`, only keys that gitleaks 8.30.1 and Betterleaks read alike).
2. Copy `scripts/check-allowlist.mts` (Node >= 22.18, no build) into the repository (below: under `scripts`, folder `secret-scan`).
3. Wire the gate as `checks` entries of `.agents/config.json` with `fast: true`:

```json
{
  "checks": [
    {
      "name": "secret-scan",
      "command": "pwsh scripts/secret-scan/Invoke-SecretScan.ps1",
      "fast": true
    },
    {
      "name": "secret-allowlist",
      "command": "node scripts/secret-scan/check-allowlist.mts",
      "fast": true
    }
  ]
}
```

4. Copy `templates/secret-scan.yml` to `.github/workflows/`: on `pull_request` it scans `origin/<base>..HEAD` with `--redact`, installs the pinned `gitleaks` release binary after a sha256 check (update version and hash together), no `gitleaks-action`. Repositories on the shared `GravionLabs/ci` get the job there.

## Scan

```powershell
pwsh scripts/Invoke-SecretScan.ps1 [-Base <branch>]
```

Scans the uncommitted changes, the staged changes and the commits of `<base>..HEAD` with `--redact`; a finding never prints the value. Exit 0 clean, 1 a finding, 2 `gitleaks` missing (install hint; `check-prerequisites` installs tools) or failed.

## A finding

1. Real secret: rotate it first (revoke, issue a new one, remove it from the code), only then allowlist what stays in history.
2. Fake value: allowlist it with the reason.
3. Allowlist form and `check-allowlist.mts`: `references/allowlist.md`. Inline `gitleaks:allow` is not used.

## Not used

`gitleaks-action` (needs a `GITLEAKS_LICENSE` for organizations), TruffleHog, GitHub secret-scanning settings.

## Betterleaks

Switch to Betterleaks when 2.0 is final: the `.gitleaks.toml` stays unchanged, only the binary in the script and CI changes.
