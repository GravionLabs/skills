<#
.SYNOPSIS
  Scans the uncommitted changes, the staged changes and the commits of <Base>..HEAD for secrets with gitleaks.
.DESCRIPTION
  Runs `gitleaks git --pre-commit` (uncommitted changes), `gitleaks git --staged` and
  `gitleaks git --log-opts "<Base>..HEAD"` (commits of the branch; without a Base ref the whole history of HEAD),
  each with `--redact` so a finding never prints the secret. The configuration is `.gitleaks.toml` of the
  repository when it exists (Betterleaks reads the same file), else the gitleaks default rules.
  Exit 0 clean, 1 a finding, 2 gitleaks is missing (install hint) or failed to run.
.PARAMETER Base
  Branch or ref the branch started from. Default: the default branch of origin, else main; when the ref does not
  exist the whole history of HEAD is scanned.
.PARAMETER Path
  Repository to scan. Default: the current directory.
#>
[CmdletBinding()]
param(
  [string]$Base,
  [string]$Path = '.'
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if (-not (Get-Command gitleaks -ErrorAction SilentlyContinue)) {
  Write-Error 'Invoke-SecretScan: gitleaks is not installed. Install: brew install gitleaks | scoop install gitleaks | winget install gitleaks.gitleaks | go install github.com/zricethezav/gitleaks/v8@latest (check-prerequisites lists the tools).' -ErrorAction Continue
  exit 2
}

Push-Location -LiteralPath $Path
try {
  if (-not $Base) {
    $head = (git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>$null)
    $Base = if ($LASTEXITCODE -eq 0 -and $head) { $head } else { 'main' }
  }
  $global:LASTEXITCODE = 0
  $range = $null
  git rev-parse --verify --quiet "$Base^{commit}" *> $null
  if ($LASTEXITCODE -eq 0) { $range = "$Base..HEAD" }
  $global:LASTEXITCODE = 0

  $common = @('--redact', '--verbose', '--no-banner', '--exit-code', '3')
  if (Test-Path -LiteralPath '.gitleaks.toml') { $common += @('--config', '.gitleaks.toml') }

  $scans = @(
    @{ Name = 'uncommitted changes'; Args = @('git', '--pre-commit') },
    @{ Name = 'staged changes'; Args = @('git', '--staged') },
    @{ Name = $(if ($range) { "commits $range" } else { 'commits of HEAD' }); Args = $(if ($range) { @('git', '--log-opts', $range) } else { @('git') }) }
  )
  $leaks = $false
  foreach ($scan in $scans) {
    Write-Host "secret-scan: $($scan.Name)"
    & gitleaks @($scan.Args) @common .
    switch ($LASTEXITCODE) {
      0 { }
      3 { $leaks = $true }
      default { Write-Error "Invoke-SecretScan: gitleaks failed with exit code $LASTEXITCODE" -ErrorAction Continue; exit 2 }
    }
  }
  if ($leaks) {
    Write-Host 'secret-scan: secrets found. Rotate a real secret first, then allowlist it (references/allowlist.md).'
    exit 1
  }
  Write-Host 'secret-scan: clean'
  exit 0
}
finally { Pop-Location }
