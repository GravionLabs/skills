<#
.SYNOPSIS
  Files the notes[] of a clean release review as issues (deliver step 9, references/release-review.md).
.DESCRIPTION
  One issue per note, without a milestone: `[Bug] fix: <note>` (label bug) when the note is a defect, else
  `[PBI] feat: <note>` (label pbi); label needs-refinement when the criteria are unclear. The body carries
  `Related: #<PBI>` (when given) and the marker `Found in release review <key> (round <n>, note)`.
  An open or closed issue with the same title and a marker `Found in release review <key> (round ` is
  skipped (reported under `existing`), so a rerun files nothing twice. Reads and writes through gh REST.
  Prints JSON { filed[], existing[], urls[] } (each entry { number, url, title, note }); with -DryRun nothing is
  created and `filed` lists what would be.
.PARAMETER Notes
  JSON file: an array of strings (a PBI each) or objects { note, defect, unclear, related } (defect and unclear
  booleans, related the PBI number). At most 5 are filed.
.PARAMETER Key
  Unpadded milestone key (M3, M11.1).
.PARAMETER Round
  Release-review round.
.PARAMETER Repo
  owner/repo (default: the repository of the current directory).
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Notes,
  [Parameter(Mandatory)][string]$Key,
  [Parameter(Mandatory)][int]$Round,
  [string]$Repo = '{owner}/{repo}',
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$items = @(Get-Content -LiteralPath $Notes -Raw | ConvertFrom-Json) | Select-Object -First 5
$items = @($items | ForEach-Object {
  if ($_ -is [string]) { [pscustomobject]@{ note = $_; defect = $false; unclear = $false; related = $null } }
  else { [pscustomobject]@{ note = [string]$_.note; defect = [bool]$_.defect; unclear = [bool]$_.unclear; related = $_.related } }
} | Where-Object { $_.note -and $_.note.Trim() })

$markerPrefix = "Found in release review $Key (round "
$raw = & gh api "repos/$Repo/issues?state=all&per_page=100" --paginate --slurp
if ($LASTEXITCODE -ne 0) { throw "gh api repos/$Repo/issues failed" }
$existingIssues = @(($raw -join "`n" | ConvertFrom-Json) | ForEach-Object { $_ } | ForEach-Object { $_ } |
  Where-Object { -not $_.pull_request -and $_.body -and $_.body.Contains($markerPrefix) })

$filed = @(); $existing = @()
foreach ($n in $items) {
  $text = $n.note.Trim() -replace '\s+', ' '
  $short = if ($text.Length -gt 80) { $text.Substring(0, 77).TrimEnd() + '...' } else { $text }
  $title = if ($n.defect) { "[Bug] fix: $short" } else { "[PBI] feat: $short" }
  $dup = $existingIssues | Where-Object { $_.title -eq $title } | Select-Object -First 1
  if ($dup) { $existing += [pscustomobject]@{ number = $dup.number; url = $dup.html_url; title = $title; note = $text }; continue }
  $labels = @(if ($n.defect) { 'bug' } else { 'pbi' })
  if ($n.unclear) { $labels += 'needs-refinement' }
  $lines = @('## Description', '', $text, '', '## Acceptance Criteria', '',
    $(if ($n.defect) { '- [ ] The defect is resolved, with a test' } else { '- [ ] The note is addressed, with a test' }), '')
  if ($n.related) { $lines += "Related: #$($n.related)"; $lines += '' }
  $lines += "$markerPrefix$Round, note)"
  $entry = [pscustomobject]@{ number = $null; url = $null; title = $title; note = $text }
  if (-not $DryRun) {
    $body = @{ title = $title; body = ($lines -join "`n"); labels = $labels } | ConvertTo-Json -Compress
    $out = $body | & gh api -X POST "repos/$Repo/issues" --input - | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0) { throw "gh api POST repos/$Repo/issues failed" }
    $entry.number = $out.number; $entry.url = $out.html_url
  }
  $filed += $entry
}
[pscustomobject]@{
  filed    = $filed
  existing = $existing
  urls     = @(($filed + $existing) | Where-Object { $_.url } | ForEach-Object { $_.url })
} | ConvertTo-Json -Depth 5 -Compress
