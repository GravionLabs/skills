<#
.SYNOPSIS
  Open PRs into release/next with auto-merge on whose issue is in the set (deliver step 1, loop wait).
.DESCRIPTION
  One REST list call (pulls?base=release/next&state=open, auto_merge != null), then per matching PR its check runs, only the required checks of release/next (branch rules, all runs when none can be read; cancelled is not red).
  The issue number comes from the head branch <type>/<nr>-<slug>. Prints a JSON array of
  { issue, pr, url, state, reason }, state:
    waiting      checks still running or all green: auto-merge will merge, nothing to do
    red-change   a check failed that is not red on release/next: fix round (deliver step 5)
    red-other    a check failed that is red on release/next too, or the PR conflicts: comment, PBI blocked
  A merged PR is no longer open and so not listed: its issue is closed.
.PARAMETER Issues
  Issue numbers of the set; PRs of other issues are ignored.
#>
[CmdletBinding()]
param([Parameter(Mandatory)][string[]]$Issues)

$ErrorActionPreference = 'Stop'
$set = @($Issues | ForEach-Object { $_ -split ',' } | Where-Object { $_ } | ForEach-Object { [int]$_ })
$badConclusions = 'failure', 'timed_out', 'action_required', 'startup_failure'

function Get-Gh([string]$path) {
  $out = & gh api $path 2>$null
  if ($LASTEXITCODE -ne 0) { throw "gh api $path failed" }
  if (-not $out) { return $null }
  return ($out -join "`n") | ConvertFrom-Json
}

# Required checks of release/next (branch rules); unreadable or none: all check runs count. cancelled is not red.
$required = @()
try {
  $required = @(@(Get-Gh 'repos/{owner}/{repo}/rules/branches/release/next') | Where-Object { $_ -and $_.type -eq 'required_status_checks' } |
      ForEach-Object { $_.parameters.required_status_checks } | ForEach-Object { $_.context } | Where-Object { $_ })
} catch { $required = @() }

function Get-Failed([string]$sha) {
  $runs = @((Get-Gh "repos/{owner}/{repo}/commits/$sha/check-runs?per_page=100").check_runs)
  if ($required.Count) { $runs = @($runs | Where-Object { $required -contains $_.name }) }
  [pscustomobject]@{
    Failed  = @($runs | Where-Object { $_.status -eq 'completed' -and $_.conclusion -in $badConclusions } | ForEach-Object { $_.name })
  }
}

$result = @()
$base = $null
foreach ($pr in @(Get-Gh 'repos/{owner}/{repo}/pulls?base=release/next&state=open&per_page=100')) {
  if (-not $pr -or -not $pr.auto_merge -or $pr.head.ref -notmatch '^[^/]+/(\d+)-') { continue }
  $nr = [int]$Matches[1]
  if ($set -notcontains $nr) { continue }
  $state = 'waiting'; $reason = 'waits for checks'
  $failed = @((Get-Failed $pr.head.sha).Failed)
  if ($failed.Count) {
    if ($null -eq $base) { $sha = (Get-Gh 'repos/{owner}/{repo}/branches/release/next').commit.sha; $base = @((Get-Failed $sha).Failed) }
    $mine = @($failed | Where-Object { $base -notcontains $_ })
    if ($mine.Count) { $state = 'red-change'; $reason = "red: $($mine -join ', ')" }
    else { $state = 'red-other'; $reason = "red on release/next too: $($failed -join ', ')" }
  } else {
    $detail = Get-Gh "repos/{owner}/{repo}/pulls/$($pr.number)"
    if ($detail.mergeable -eq $false -or $detail.mergeable_state -eq 'dirty') { $state = 'red-other'; $reason = 'merge conflict' }
  }
  $result += [pscustomobject]@{ issue = $nr; pr = [int]$pr.number; url = [string]$pr.html_url; state = $state; reason = $reason }
}
ConvertTo-Json -InputObject @($result) -Depth 4 -Compress
