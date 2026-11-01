<#
.SYNOPSIS
  Copies the governance skip labels of an issue onto its pull request (REST), as JSON { added, missing }.
.DESCRIPTION
  Reads governance.skipLabels of .agents/config.json (default ["skip-adr"] when the governance key exists;
  no governance key or no config: nothing happens). Of the -IssueLabel values only those in skipLabels are
  copied. A label that does not exist in the repository is listed in `missing` and never created. The CI
  check `adr` reads only the labels of the PR, so call this right after `gh pr create`.
.PARAMETER Pr
  Pull request number.
.PARAMETER IssueLabel
  Label names of the issue.
.PARAMETER Config
  Path of .agents/config.json; default: the one at the git top level (or the current directory).
.PARAMETER Repo
  owner/name; default: the repository of the current directory ({owner}/{repo} of gh).
#>
param(
  [Parameter(Mandatory)][int]$Pr,
  [string[]]$IssueLabel = @(),
  [string]$Config,
  [string]$Repo = '{owner}/{repo}'
)
$ErrorActionPreference = 'Stop'

if (-not $Config) {
  $top = (& git rev-parse --show-toplevel 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $top) { $top = (Get-Location).Path }
  $Config = Join-Path $top '.agents/config.json'
}
$skip = @()
if (Test-Path -LiteralPath $Config) {
  $cfg = Get-Content -Raw -LiteralPath $Config | ConvertFrom-Json -AsHashtable
  $gov = $cfg['governance']
  if ($gov -is [System.Collections.IDictionary]) {
    $skip = if ($null -ne $gov['skipLabels']) { @($gov['skipLabels']) } else { @('skip-adr') }
  }
}
$wanted = @($IssueLabel | ForEach-Object { $_ -split ',' } | Where-Object { $_ -and ($skip -contains $_) } | Select-Object -Unique)
$added = @()
$missing = @()
foreach ($l in $wanted) {
  & gh api "repos/$Repo/labels/$([uri]::EscapeDataString($l))" 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $added += $l } else { $missing += $l }
}
if ($added.Count -gt 0) {
  $ghArgs = @('api', '-X', 'POST', "repos/$Repo/issues/$Pr/labels") + @($added | ForEach-Object { '-f'; "labels[]=$_" })
  & gh @ghArgs 2>$null | Out-Null
  if ($LASTEXITCODE -ne 0) { Write-Error "gh api POST labels of PR $Pr failed" -ErrorAction Continue; exit 1 }
}
[ordered]@{ added = $added; missing = $missing } | ConvertTo-Json -Compress
