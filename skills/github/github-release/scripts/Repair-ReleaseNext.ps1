<#
.SYNOPSIS
  Cleanup of `github-release finish` after a merged release PR: recreates a missing release/next and retargets the PRs
  GitHub moved to the default branch; prints one JSON object.
.DESCRIPTION
  Without a merged PR from release/next into the default branch nothing is done (status none). Else New-ReleaseNext.ps1
  creates origin/release/next from the default branch when it is missing, and every `retargetedPrs` entry of
  Get-ReleaseState.ps1 is moved back with `gh pr edit <nr> --base release/next`. Never deletes or force pushes.
  Output: {status, branch, retargeted[], failed[], detail}. status: none, done or failed (the branch could not be
  created: nothing is retargeted; or an edit failed: `failed` holds {number, detail}). branch: the status of
  New-ReleaseNext.ps1 (present, created, refused, unreachable) or null. Exit 0, or 1 with a message on stderr when
  gh or git cannot be read.
.PARAMETER ProjectRoot
  Repository (default: current directory).
#>
param([string]$ProjectRoot = (Get-Location).Path)
$ErrorActionPreference = 'Stop'

function Fail([string]$m) { Write-Error $m -ErrorAction Continue; exit 1 }
function Out-Result([string]$status, $branch, $retargeted, $failed, [string]$detail) {
  [ordered]@{ status = $status; branch = $branch; retargeted = @($retargeted); failed = @($failed); detail = $detail } |
    ConvertTo-Json -Depth 4
  exit 0
}

Push-Location -LiteralPath $ProjectRoot
try {
  $default = ([string](& gh api 'repos/{owner}/{repo}' --jq .default_branch 2>$null)).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $default) { Fail 'default branch unknown: gh api failed' }
  $raw = & gh pr list --base $default --head release/next --state merged --limit 1 --json number 2>$null
  if ($LASTEXITCODE -ne 0) { Fail 'gh pr list failed' }
  if (@($raw | ConvertFrom-Json).Count -eq 0) { Out-Result 'none' $null @() @() 'no merged release PR' }

  $raw = & "$PSScriptRoot/New-ReleaseNext.ps1" -ProjectRoot (Get-Location).Path
  if (-not $raw) { Fail 'New-ReleaseNext.ps1 failed' }
  $created = $raw | ConvertFrom-Json
  if ($created.status -notin 'present', 'created') { Out-Result 'failed' $created.status @() @() $created.detail }

  $raw = & "$PSScriptRoot/Get-ReleaseState.ps1" -Mode finish -Branch release/next
  if (-not $raw) { Fail 'Get-ReleaseState.ps1 failed' }
  $retargeted = @(); $failed = @()
  foreach ($pr in @(($raw | ConvertFrom-Json).retargetedPrs)) {
    $err = (& gh pr edit $pr.number --base release/next 2>&1) -join ' '
    if ($LASTEXITCODE -eq 0) { $retargeted += $pr.number }
    else { $failed += [ordered]@{ number = $pr.number; detail = $err.Trim() } }
  }
  Out-Result $(if ($failed.Count) { 'failed' } else { 'done' }) $created.status $retargeted $failed $created.detail
} finally { Pop-Location }
