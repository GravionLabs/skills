<#
.SYNOPSIS
  Remove the worktrees and local branches a merged PBI left behind; prints one JSON object.
.DESCRIPTION
  Subagents work in worktrees of their own. A harness keeps a worktree whose HEAD left its start commit (Claude Code
  removes an isolated worktree only when the agent left it unchanged), and its `worktree-<name>` branch stays even when
  the worktree goes. After the merge of PR -Pr this script removes, in the repository of the current directory:
  - worktrees on the head branch of the PR or on `wip-<Issue>`, and detached worktrees at a commit of the PR,
    when they have no uncommitted changes (the main worktree and the current one are never touched);
  - the local branches `<head branch>` and `wip-<Issue>` when no worktree has them checked out;
  - `worktree-<name>` branches whose worktree `<name>` is gone and that have no commits beyond `origin/<base branch>`.
  A worktree with uncommitted changes or a branch still checked out is listed in `left` with the command to remove it.
  Output: {removed[], branchesDeleted[], left[{path|branch, reason, command}]}. Exit 1 when the PR cannot be read.
.PARAMETER Pr
  Number of the merged pull request.
.PARAMETER Issue
  Number of the PBI (for the `wip-<Issue>` branch).
#>
param(
  [Parameter(Mandatory)][int]$Pr,
  [Parameter(Mandatory)][int]$Issue
)
$ErrorActionPreference = 'Stop'

function Fail([string]$m) { Write-Error $m -ErrorAction Continue; exit 1 }

$json = & gh pr view $Pr --json headRefName,baseRefName,commits 2>$null
if ($LASTEXITCODE -ne 0 -or -not $json) { Fail "gh pr view $Pr failed" }
$info = $json | ConvertFrom-Json
$head = $info.headRefName
$shas = @($info.commits | ForEach-Object { $_.oid })
$branches = @($head, "wip-$Issue")

$self = (& git rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0) { Fail 'not inside a git repository' }
$self = [IO.Path]::GetFullPath($self)

# git worktree list --porcelain: blocks of `worktree <path>`, `HEAD <sha>`, `branch refs/heads/<b>` or `detached`
function Get-Worktrees {
  $list = @()
  $cur = $null
  foreach ($line in (& git worktree list --porcelain)) {
    if ($line -like 'worktree *') { $cur = [ordered]@{ path = $line.Substring(9); head = $null; branch = $null }; $list += $cur }
    elseif ($line -like 'HEAD *') { $cur.head = $line.Substring(5) }
    elseif ($line -like 'branch refs/heads/*') { $cur.branch = $line.Substring(18) }
  }
  return $list
}

$removed = [System.Collections.Generic.List[string]]::new()
$deleted = [System.Collections.Generic.List[string]]::new()
$left = [System.Collections.Generic.List[object]]::new()

$all = @(Get-Worktrees)
foreach ($w in ($all | Select-Object -Skip 1)) {
  if ([IO.Path]::GetFullPath($w.path) -eq $self) { continue }
  $match = if ($w.branch) { $branches -contains $w.branch } else { $shas -contains $w.head }
  if (-not $match) { continue }
  $dirty = & git -C $w.path status --porcelain 2>$null
  if ($dirty) {
    $left.Add([ordered]@{ path = $w.path; reason = 'uncommitted changes'; command = "git worktree remove --force $($w.path)" })
    continue
  }
  & git worktree remove $w.path 2>$null
  if ($LASTEXITCODE -eq 0) { $removed.Add($w.path) }
  else { $left.Add([ordered]@{ path = $w.path; reason = 'git worktree remove failed'; command = "git worktree remove --force $($w.path)" }) }
}
& git worktree prune 2>$null

$remaining = @(Get-Worktrees)
$checkedOut = @($remaining | Where-Object { $_.branch } | ForEach-Object { $_.branch })
$wtNames = @($remaining | ForEach-Object { "worktree-$(Split-Path -Leaf $_.path)" })
$local = @(& git for-each-ref --format='%(refname:short)' refs/heads)
foreach ($b in $branches) {
  if ($local -notcontains $b) { continue }
  if ($checkedOut -contains $b) {
    $left.Add([ordered]@{ branch = $b; reason = 'checked out in a worktree'; command = "git branch -D $b" })
    continue
  }
  & git branch -D $b 2>$null | Out-Null
  if ($LASTEXITCODE -eq 0) { $deleted.Add($b) }
}

# leftover worktree-<name> branches of removed worktrees: only those without own commits
$base = "origin/$($info.baseRefName)"
& git rev-parse --verify --quiet $base 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) {
  foreach ($b in ($local | Where-Object { $_ -like 'worktree-*' -and $checkedOut -notcontains $_ -and $wtNames -notcontains $_ })) {
    if ((& git rev-list --count "$base..$b") -eq '0') {
      & git branch -D $b 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) { $deleted.Add($b) }
    }
  }
}

[ordered]@{ removed = @($removed); branchesDeleted = @($deleted); left = @($left) } | ConvertTo-Json -Depth 4
