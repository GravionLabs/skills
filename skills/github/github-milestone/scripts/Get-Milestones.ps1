<#
.SYNOPSIS
  Milestones of a repository as JSON (schema/milestones.schema.json) for the github-milestone skill.
.DESCRIPTION
  current, list and show are read-only and use only `gh api` GET calls (REST). create is the one write.
  current: the open milestone with the lowest semver title above the latest release tag v<x.y.z>
  ({ current: null, hint } when there is none). list: all milestones, open and closed, sorted by semver
  (non-semver titles last). show: one milestone by -Name. current and show group the open issues (pull
  requests filtered out) as needsDecision, needsRefinement, blocked (open blockers), claimed (assignee)
  and ready, in that precedence (a blocker from another repository carries repository owner/repo), and add the release PR release/next -> default from Get-ReleaseState.ps1
  of the github-release skill. create: creates milestone <x.y.z> when no milestone has that title; it
  never renames or closes one. issues: resolves the milestone title -Name to its number and lists its issues
  (body, labels, assignees, state; pull requests filtered out) in one paginated REST call, for the batched
  reads of deliver; unknown milestone: exit 1.
.PARAMETER Mode
  current, list, show, create or issues.
.PARAMETER Name
  show and create: the milestone title, a bare version x.y.z (a leading v is dropped).
.PARAMETER State
  issues: open, closed or all (default).
.PARAMETER Repo
  owner/name; default: the repository of the current directory ({owner}/{repo} of gh).
.PARAMETER ReleaseState
  Path of Get-ReleaseState.ps1; default: the sibling github-release skill. Missing: releasePr is null.
#>
param(
  [Parameter(Mandatory)][ValidateSet('current', 'list', 'show', 'create', 'issues')][string]$Mode,
  [string]$Name,
  [ValidateSet('open', 'closed', 'all')][string]$State = 'all',
  [string]$Repo = '{owner}/{repo}',
  [string]$ReleaseState = (Join-Path $PSScriptRoot '../../github-release/scripts/Get-ReleaseState.ps1')
)
$ErrorActionPreference = 'Stop'

function Fail([string]$m) { Write-Error $m -ErrorAction Continue; exit 1 }

# GET with --paginate --slurp: one array of pages, flattened to the items
function Get-Paged([string]$path) {
  $raw = & gh api $path --paginate --slurp 2>$null
  if ($LASTEXITCODE -ne 0) { Fail "gh api $path failed" }
  $items = [System.Collections.Generic.List[object]]::new()
  Add-Leaf $items ($raw | Out-String | ConvertFrom-Json -NoEnumerate)
  $items.ToArray()
}
function Add-Leaf($list, $x) {
  if ($x -is [System.Collections.IList]) { foreach ($e in $x) { Add-Leaf $list $e } }
  elseif ($null -ne $x) { $list.Add($x) }
}

$semverRx = '^([0-9]+)\.([0-9]+)\.([0-9]+)$'
function ConvertTo-Version([string]$t) { if ($t -match $semverRx) { [version]"$($Matches[1]).$($Matches[2]).$($Matches[3])" } else { $null } }
function Get-Bare([string]$n) { $n -replace '^v(?=[0-9])', '' }

$milestones = @(Get-Paged "repos/$Repo/milestones?state=all&per_page=100")

if ($Mode -eq 'create') {
  $title = Get-Bare $Name
  if (-not (ConvertTo-Version $title)) { Fail "invalid milestone name '$Name': expected x.y.z" }
  $existing = $milestones | Where-Object { (Get-Bare $_.title) -eq $title } | Select-Object -First 1
  $created = -not $existing
  if ($created) {
    $raw = & gh api -X POST "repos/$Repo/milestones" -f "title=$title" 2>$null
    if ($LASTEXITCODE -ne 0) { Fail "creating milestone $title failed" }
    $existing = $raw | ConvertFrom-Json
  }
  [ordered]@{ created = $created; milestone = [ordered]@{ number = $existing.number; title = $existing.title; state = $existing.state; url = $existing.html_url } } |
    ConvertTo-Json -Depth 4
  exit 0
}

if ($Mode -eq 'issues') {
  if (-not $Name) { Fail 'issues needs -Name <milestone title>' }
  $m = $milestones | Where-Object { $_.title -eq $Name -or $_.title -eq (Get-Bare $Name) } | Select-Object -First 1
  if (-not $m) { Fail "milestone '$Name' not found" }
  $list = @(Get-Paged "repos/$Repo/issues?milestone=$($m.number)&state=$State&per_page=100" | Where-Object { $null -eq $_.pull_request } | Sort-Object number | ForEach-Object {
      [ordered]@{
        number = $_.number; title = $_.title; state = $_.state; closed_at = $_.closed_at; body = $_.body
        labels = @($_.labels | ForEach-Object { $_.name }); assignees = @($_.assignees | ForEach-Object { $_.login })
      }
    })
  [ordered]@{ milestone = [ordered]@{ number = $m.number; title = $m.title; state = $m.state }; issues = $list } | ConvertTo-Json -Depth 6
  exit 0
}

$tags = @((Get-Paged "repos/$Repo/tags?per_page=100") | ForEach-Object { $_.name })
$released = @($tags | Where-Object { $_ -match '^v[0-9]+\.[0-9]+\.[0-9]+$' } | Sort-Object { [version]($_.Substring(1)) })
$latestTag = if ($released.Count) { $released[-1] } else { $null }

function Get-Summary($m) {
  $total = [int]$m.open_issues + [int]$m.closed_issues
  [ordered]@{
    number = $m.number; title = $m.title; state = $m.state; dueOn = $m.due_on
    open = [int]$m.open_issues; closed = [int]$m.closed_issues
    progress = if ($total) { [int][math]::Round(100 * [int]$m.closed_issues / $total) } else { 0 }
    tagged = $tags -contains "v$($m.title)"; url = $m.html_url
  }
}

function Get-ReleasePr {
  if (-not (Test-Path $ReleaseState)) { return $null }
  try {
    $raw = & $ReleaseState -Mode finish -Branch release/next 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
    $pr = ($raw | Out-String | ConvertFrom-Json).releasePr
    if ($pr) { [ordered]@{ number = $pr.number; url = $pr.url } } else { $null }
  }
  catch { $null }
}

function Get-Detail($m) {
  $d = Get-Summary $m
  $groups = [ordered]@{ ready = @(); blocked = @(); needsDecision = @(); needsRefinement = @(); claimed = @() }
  $issues = @(Get-Paged "repos/$Repo/issues?milestone=$($m.number)&state=open&per_page=100" | Where-Object { $null -eq $_.pull_request })
  foreach ($i in ($issues | Sort-Object number)) {
    $labels = @($i.labels | ForEach-Object { $_.name })
    $assignees = @($i.assignees | ForEach-Object { $_.login })
    $item = [ordered]@{ number = $i.number; title = $i.title; assignees = $assignees }
    $sum = $i.issue_dependencies_summary
    $blockers = @()
    if ($null -eq $sum -or [int]$sum.blocked_by -gt 0) {
      $blockers = @(Get-Paged "repos/$Repo/issues/$($i.number)/dependencies/blocked_by" | Where-Object { $_.state -eq 'open' } |
          ForEach-Object {
            $b = [ordered]@{ number = $_.number; title = $_.title }
            # a blocker in another repository keeps its owner/repo, so #n never names a local issue
            if ($_.repository_url -and $_.repository_url -ne $i.repository_url) { $b.repository = $_.repository_url -replace '^.*/repos/', '' }
            $b
          })
    }
    $key = if ($labels -contains 'needs-decision') { 'needsDecision' }
    elseif ($labels -contains 'needs-refinement') { 'needsRefinement' }
    elseif ($blockers.Count) { 'blocked' }
    elseif ($assignees.Count) { 'claimed' }
    else { 'ready' }
    if ($key -eq 'blocked') { $item.blockers = $blockers }
    $groups[$key] += , $item
  }
  $d.issues = $groups
  $d.releasePr = Get-ReleasePr
  $d
}

switch ($Mode) {
  'list' {
    $sorted = @($milestones | Sort-Object @{ e = { if (ConvertTo-Version $_.title) { 0 } else { 1 } } }, @{ e = { ConvertTo-Version $_.title } }, @{ e = { $_.title } })
    [ordered]@{ latestTag = $latestTag; milestones = @($sorted | ForEach-Object { Get-Summary $_ }) } | ConvertTo-Json -Depth 6
  }
  'show' {
    if (-not $Name) { Fail 'show needs -Name <x.y.z>' }
    $m = $milestones | Where-Object { $_.title -eq $Name -or $_.title -eq (Get-Bare $Name) } | Select-Object -First 1
    if (-not $m) { Fail "milestone '$Name' not found" }
    Get-Detail $m | ConvertTo-Json -Depth 8
  }
  'current' {
    $floor = if ($latestTag) { [version]$latestTag.Substring(1) } else { [version]'0.0.0' }
    $m = @($milestones | Where-Object { $_.state -eq 'open' -and (ConvertTo-Version $_.title) -gt $floor } | Sort-Object { ConvertTo-Version $_.title }) | Select-Object -First 1
    if ($m) { [ordered]@{ latestTag = $latestTag; current = Get-Detail $m } | ConvertTo-Json -Depth 8 }
    else {
      $hint = "no open milestone above $(if ($latestTag) { $latestTag } else { 'the first release' }); create one with /github-milestone create <x.y.z>"
      [ordered]@{ latestTag = $latestTag; current = $null; hint = $hint } | ConvertTo-Json -Depth 4
    }
  }
}
