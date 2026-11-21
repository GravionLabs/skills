<#
.SYNOPSIS
Lints .github/workflows/ with actionlint and zizmor (offline). Prints findings only.
.DESCRIPTION
Exit 0: clean, or no workflows (prints "skipped: no workflows"). Exit 1: a tool found something.
Exit 2: actionlint, zizmor or shellcheck is missing (prints the install hint).
zizmor reads zizmor.yml or .github/zizmor.yml of the repository, else the template of this skill.
#>
[CmdletBinding()]
param(
    [string]$Path = '.'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Path).Path
$workflows = Join-Path $root '.github/workflows'
if (-not (Test-Path -LiteralPath $workflows -PathType Container)) {
    Write-Output 'skipped: no workflows'
    exit 0
}

$hints = [ordered]@{
    actionlint = 'actionlint 1.7.12: https://github.com/rhysd/actionlint/blob/main/docs/install.md'
    zizmor     = 'zizmor 1.32.0: pipx install zizmor==1.32.0 (or cargo install zizmor, brew install zizmor)'
    shellcheck = 'shellcheck (actionlint checks the run: scripts with it): apt install shellcheck, brew install shellcheck'
}
$missing = @($hints.Keys | Where-Object { -not (Get-Command $_ -CommandType Application -ErrorAction SilentlyContinue) })
if ($missing.Count -gt 0) {
    foreach ($m in $missing) { [Console]::Error.WriteLine("missing tool $m. Install $($hints[$m])") }
    exit 2
}

$failed = $false
Push-Location $root
try {
    $out = & actionlint 2>&1
    if ($LASTEXITCODE -ne 0) { $failed = $true; $out | ForEach-Object { Write-Output "$_" } }

    $config = @('zizmor.yml', '.github/zizmor.yml') | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $config) { $config = Join-Path $PSScriptRoot '../templates/zizmor.yml' }
    # offline: no token reaches zizmor, online-only audits are skipped
    $saved = @{}
    foreach ($v in 'GH_TOKEN', 'GITHUB_TOKEN', 'ZIZMOR_GITHUB_TOKEN') {
        $saved[$v] = [Environment]::GetEnvironmentVariable($v)
        # Remove-Item, not SetEnvironmentVariable($null): on Linux that leaves an empty variable and zizmor rejects an empty token
        Remove-Item -LiteralPath "env:$v" -ErrorAction SilentlyContinue
    }
    try { $out = & zizmor --offline --format=github --config $config .github/workflows 2>&1 }
    finally {
        foreach ($v in $saved.Keys) {
            if ($null -ne $saved[$v]) { [Environment]::SetEnvironmentVariable($v, $saved[$v]) }
        }
    }
    if ($LASTEXITCODE -ne 0) { $failed = $true; $out | ForEach-Object { Write-Output "$_" } }
}
finally { Pop-Location }

if ($failed) { exit 1 }
exit 0
