<#
.SYNOPSIS
  Checks an existing PR of the own PBI branch and repairs it (deliver step 2).
.DESCRIPTION
  A PR opened by hand ("Compare & pull request") targets main, is titled like the branch and has an empty body.
  Reads the PR and the issue (REST GET), then fixes with one `gh pr edit` call, only the fields that differ:
    base   the integration branch (-Base, default release/next); a PR already on a release/* branch stays,
           a fix/* head on main is a hotfix and stays
    title  Conventional Commit with (#<Issue>); not one: <type from branch>: <issue title without [Level]> (#<Issue>)
    body   contains `Closes #<Issue>`; an existing body is kept, the line is appended
  A PR from a foreign head repository (fork) is never modified.
  Prints JSON { pr, issue, changed[], foreign, error, command }. Exit 0: repaired or nothing to do;
  1: repair failed (error and the exact command are set); 3: foreign head repository (not modified).
  Auto-merge is not touched; deliver step 8 enables it after a successful repair.
.PARAMETER Pr
  PR number.
.PARAMETER Issue
  Issue number of the PBI or Bug.
.PARAMETER Base
  Integration branch (release/next or release/<x.y>).
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][int]$Pr,
  [Parameter(Mandatory)][int]$Issue,
  [string]$Base = 'release/next'
)

$ErrorActionPreference = 'Stop'
$result = [ordered]@{ pr = $Pr; issue = $Issue; changed = @(); foreign = $false; error = $null; command = $null }

function Get-Gh([string]$path) {
  $out = & gh api $path 2>&1
  if ($LASTEXITCODE -ne 0) { throw "gh api $path failed: $($out -join ' ')" }
  return ($out -join "`n") | ConvertFrom-Json
}
function Write-Result([int]$code) {
  $result.changed = @($result.changed)
  $result | ConvertTo-Json -Depth 4 -Compress
  exit $code
}

try {
  $p = Get-Gh "repos/{owner}/{repo}/pulls/$Pr"
  if ($p.head.repo.full_name -ne $p.base.repo.full_name) {
    $result.foreign = $true
    Write-Result 3
  }
  $i = Get-Gh "repos/{owner}/{repo}/issues/$Issue"

  $head = [string]$p.head.ref
  $type = if ($head -match '^([a-z]+)/') { $Matches[1] } else { 'chore' }
  $newBase = $null; $newTitle = $null; $newBody = $null

  $hotfix = $head -like 'fix/*' -and $p.base.ref -eq 'main'
  if (-not $hotfix -and $p.base.ref -notlike 'release/*') { $newBase = $Base }

  $title = [string]$p.title
  if ($title -notmatch '^[a-z]+(\([^)]+\))?!?: \S') {
    $summary = ([string]$i.title) -replace '^\s*\[[^\]]+\]\s*', ''
    $title = if ($summary -match '^[a-z]+(\([^)]+\))?!?: \S') { $summary } else { "${type}: $summary" }
  }
  if ($title -notmatch "\(#$Issue\)\s*$") { $title = "$($title.TrimEnd()) (#$Issue)" }
  if ($title -ne [string]$p.title) { $newTitle = $title }

  $body = [string]$p.body
  if ($body -notmatch "(?i)\b(closes|fixes|resolves)\s+#$Issue\b") {
    $newBody = if ($body.Trim()) { "$($body.TrimEnd())`n`nCloses #$Issue" } else { "Closes #$Issue" }
  }

  $edit = @('pr', 'edit', "$Pr")
  $cmd = @("gh pr edit $Pr")
  if ($newBase) { $edit += '--base', $newBase; $cmd += "--base $newBase"; $result.changed += 'base' }
  if ($newTitle) { $edit += '--title', $newTitle; $cmd += "--title '$($newTitle -replace "'", "''")'"; $result.changed += 'title' }
  if ($null -ne $newBody) { $edit += '--body', $newBody; $cmd += "--body '$($newBody -replace "'", "''")'"; $result.changed += 'body' }

  if ($result.changed.Count) {
    $result.command = $cmd -join ' '
    $out = & gh @edit 2>&1
    if ($LASTEXITCODE -ne 0) { throw "gh pr edit failed: $($out -join ' ')" }
  }
  Write-Result 0
} catch {
  $result.error = $_.Exception.Message
  Write-Result 1
}
