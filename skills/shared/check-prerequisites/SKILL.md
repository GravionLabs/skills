---
name: check-prerequisites
description: 'Check that the tools the GravionLabs skills need (pwsh 7+, Git, Node.js, npm; optionally gh, jq, yq, ast-grep, Python 3) are installed, and install missing ones. Use when setting up an environment.'
---

Verify the environment for the GravionLabs skills. Paths to `scripts/` are relative to this skill's directory.

- Run `pnpm run check` to execute the local build, formatting, manifest, skill-report, and test checks.
- **Core/runtime** (always): PowerShell 7+, Git, Node.js, npm
- **Required with `sgconfig.yml`** (git toplevel or working directory, even without `-Full`): `ast-grep`; a missing one exits 1 and `-AutoInstall` installs it. The binary is `ast-grep`, never `sg` (shadow-utils on Linux).
- **Optional** (`-Full`): `gh`, `curl`, `jq`, `yq`, `ast-grep` (without `sgconfig.yml`), Python 3.

```powershell
pwsh scripts/Check-Prerequisites.ps1 [-Full] [-AutoInstall]
```

The script prints each tool with its version or ✗ and installation instructions per platform. `-AutoInstall` uses `winget` (Windows), `brew` (macOS) or `apt-get`/`dnf` (Linux).

## Gotchas

- Must run under PowerShell 7+ (`pwsh`), not `sh`
- `-AutoInstall` may need administrator rights on Windows and needs internet access
- Custom package managers are not supported; install those tools manually
