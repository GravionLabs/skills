# Prerequisites

Tools that the GravionLabs skills and their scripts depend on. Check your machine with the repo-local `check-prerequisites` skill:

```powershell
pwsh .github/skills/check-prerequisites/scripts/Check-Prerequisites.ps1          # core tools
pwsh .github/skills/check-prerequisites/scripts/Check-Prerequisites.ps1 -Full    # plus optional tools
pwsh .github/skills/check-prerequisites/scripts/Check-Prerequisites.ps1 -AutoInstall
```

`-AutoInstall` uses `winget` (Windows), `brew` (macOS) or `apt-get` / `dnf` (Linux).

## Core (every group)

| Tool                                                   | Version | Why                                                                                                                         |
| :----------------------------------------------------- | :------ | :-------------------------------------------------------------------------------------------------------------------------- |
| [PowerShell](https://github.com/PowerShell/PowerShell) | 7.4+    | All skill scripts are `pwsh` scripts. `detect-techstack` has a manual fallback, but scaffolding and report scripts need it. |
| [Git](https://git-scm.com/)                            | 2.40+   | Branching, commits, diffs in every workflow skill                                                                           |
| [Node.js](https://nodejs.org/)                         | 22+     | `npx skills` installs and updates the skills                                                                                |

Install PowerShell:

```powershell
winget install Microsoft.PowerShell        # Windows
brew install powershell/tap/powershell     # macOS
# Linux: https://learn.microsoft.com/powershell/scripting/install/install-linux
```

## Per group

| Group                     | Tools                                                                                                                                                                                     |
| :------------------------ | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `github`, `delivery`      | [GitHub CLI](https://cli.github.com/) `gh` 2.40+, authenticated (`gh auth status`). `github-release` installs [git-cliff](https://git-cliff.org/) itself when the changelog is generated. |
| `ts`                      | Node.js 22 LTS, npm; pnpm for `ts-pnpm-workflow` (the skill installs it)                                                                                                                  |
| `ng`                      | Node.js 22 LTS, Angular CLI 21+ (`npm i -g @angular/cli`)                                                                                                                                 |
| `py`                      | Python 3.14, [uv](https://docs.astral.sh/uv/)                                                                                                                                             |
| `dotnet`                  | .NET SDK 10 (libraries multi-target `net10.0;net9.0;net8.0`)                                                                                                                              |
| `shared`, `skill-tooling` | PowerShell and Git only                                                                                                                                                                   |

Install the runtimes with your platform's package manager, for example:

```powershell
winget install OpenJS.NodeJS.LTS GitHub.cli Microsoft.DotNet.SDK.10 Python.Python.3.14 astral-sh.uv   # Windows
brew install node gh dotnet-sdk python@3.14 uv                                                        # macOS
```

## Optional

`jq`, `yq`, `curl` and `ast-grep` are checked by `-Full`. A few scripts use `jq` and `curl` when present; none of the current skills require `yq` or `ast-grep`.

Language servers for Copilot CLI are described in [LSP configuration](lsp-configuration.md).
