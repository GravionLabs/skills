#Requires -Version 7
<#
.SYNOPSIS
  Sets a repository up for a GitHub Pages site in site/ (templates, workflow, Pages source "GitHub Actions").
.DESCRIPTION
  Never overwrites an existing file; a present site/ is skipped as a whole. Idempotent.
  Prints one line per file and `pages source: workflow (set|unchanged)`.
#>
[CmdletBinding()]
param(
  [ValidateSet('npm', 'pnpm')][string]$PackageManager,
  [string]$Root = (Get-Location).Path,
  [string]$Repo,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$templates = Join-Path $PSScriptRoot '../templates'

if (-not $PackageManager) {
  $PackageManager = (Test-Path (Join-Path $Root 'pnpm-lock.yaml')) ? 'pnpm' : 'npm'
}

function Copy-Template([string]$From, [string]$To, [string]$Label) {
  if (Test-Path $To) { Write-Output "${Label}: skipped (exists)"; return }
  if ($DryRun) { Write-Output "${Label}: would create"; return }
  New-Item -ItemType Directory -Force -Path (Split-Path $To) | Out-Null
  (Get-Content -Raw $From).Replace('__PACKAGE_MANAGER__', $PackageManager) | Set-Content -NoNewline -Path $To
  Write-Output "${Label}: created"
}

$siteDir = Join-Path $Root 'site'
if (Test-Path $siteDir) {
  Write-Output 'site/: skipped (exists)'
} else {
  $base = (Resolve-Path (Join-Path $templates 'site')).Path
  foreach ($f in Get-ChildItem -Recurse -File -Force $base) {
    $rel = [IO.Path]::GetRelativePath($base, $f.FullName)
    Copy-Template $f.FullName (Join-Path $siteDir $rel) ("site/$rel" -replace '\\', '/')
  }
}
Copy-Template (Join-Path $templates 'workflows/pages.yml') (Join-Path $Root '.github/workflows/pages.yml') '.github/workflows/pages.yml'

if (-not $Repo) { $Repo = (gh repo view --json nameWithOwner -q .nameWithOwner).Trim() }
if (-not $Repo) { throw 'Cannot resolve the repository; pass -Repo owner/name.' }

$pages = $null
$json = gh api "repos/$Repo/pages" 2>$null
if ($LASTEXITCODE -eq 0 -and $json) { $pages = $json | ConvertFrom-Json }

if ($pages -and $pages.build_type -eq 'workflow') {
  Write-Output 'pages source: workflow (unchanged)'
} elseif ($DryRun) {
  Write-Output 'pages source: workflow (would set)'
} else {
  $method = $pages ? 'PUT' : 'POST'
  gh api -X $method "repos/$Repo/pages" -f build_type=workflow | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "gh api $method repos/$Repo/pages failed (admin rights needed)." }
  Write-Output 'pages source: workflow (set)'
}
