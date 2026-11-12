<#
.SYNOPSIS
  Mode -Objective of Invoke-DeliverLoop.ps1 (dot-sourced, no script of its own): rounds over the ready repositories of an [Objective].
.DESCRIPTION
  One round reads Get-ObjectiveStatus.ps1 (REST GET only), starts in every repository with state `ready` the loop
  `Invoke-DeliverLoop.ps1 -Target <open sub-issues of the objective in that repo> [-Max <k>]` in the checkout of that
  repository (one after the other, each repository sequential), and reads the state again. State only from GitHub: an
  aborted round resumes with the same command. Never closes the objective (no write call of its own).
  Checkout of <owner>/<repo>: the objective's own repository is the current checkout; else an entry of
  ~/.config/deliver/checkouts.json ({ "<owner/repo>": "<path>" }), else the sibling folder <root>/<repo> of the current
  checkout (its origin must be <owner>/<repo>), else a fresh `gh repo clone` into ~/.cache/deliver/checkouts/<owner>/<repo>.
  Results: done (objective closed, 0), gated (only release gates or the acceptance of the criteria open; prints
  "needs you", 3), blocked (2), no progress (a round without change, 1); -DryRun prints the first round and exits 0.
#>

function Get-ObjectiveHome { if ($env:HOME) { $env:HOME } else { $env:USERPROFILE } }

# Get-ObjectiveStatus.ps1 in-process (it exits 1 on a failed read): its JSON or $null.
function Read-ObjectiveStatus([string]$script, [string]$ref) {
  $global:LASTEXITCODE = 0
  $out = try { & $script -Objective $ref 2>$null } catch { $null }
  if ($LASTEXITCODE -ne 0 -or -not $out) { return $null }
  try { ($out -join "`n") | ConvertFrom-Json -NoEnumerate } catch { $null }
}

# The open direct sub-issues of the objective per repository (its Features or Epics): the targets of the repo's loop.
function Get-ObjectiveTargets([string]$objRepo, [int]$objNr) {
  $raw = & gh api "repos/$objRepo/issues/$objNr/sub_issues?per_page=100" --paginate --slurp 2>$null
  $map = @{}
  if ($LASTEXITCODE -ne 0 -or -not $raw) { return $map }
  $pages = ($raw -join "`n") | ConvertFrom-Json -NoEnumerate
  foreach ($page in @($pages)) {
    foreach ($s in @($page)) {
      if (-not $s -or [string]$s.state -ne 'open') { continue }
      $repo = if ($s.repository_url) { [string]$s.repository_url -replace '^.*/repos/', '' } else { $objRepo }
      if (-not $map.ContainsKey($repo)) { $map[$repo] = @() }
      $map[$repo] += [int]$s.number
    }
  }
  $map
}

function Test-OriginOf([string]$path, [string]$repo) {
  $url = @(& git -C $path remote get-url origin 2>$null)[0]
  $LASTEXITCODE -eq 0 -and "$url" -match "[:/]$([regex]::Escape($repo))(\.git)?/?$"
}

# Where <owner>/<repo> is checked out: {Path, From (current, checkouts.json, sibling, clone), Exists}.
function Resolve-Checkout([string]$repo, [string]$objRepo, [string]$telos) {
  if ($repo -eq $objRepo) { return [pscustomobject]@{ Path = $telos; From = 'current'; Exists = $true } }
  $cfg = Join-Path (Get-ObjectiveHome) '.config/deliver/checkouts.json'
  if (Test-Path -LiteralPath $cfg) {
    try {
      $p = (Get-Content -LiteralPath $cfg -Raw | ConvertFrom-Json -AsHashtable)[$repo]
      if ($p) {
        $p = [string]$p -replace '^~(?=[/\\]|$)', (Get-ObjectiveHome)
        return [pscustomobject]@{ Path = $p; From = 'checkouts.json'; Exists = (Test-Path -LiteralPath $p) }
      }
    } catch { Write-Step "checkouts.json not readable: $_" 'yellow' }
  }
  $sibling = Join-Path (Split-Path $telos -Parent) ($repo -split '/')[1]
  if ((Test-Path -LiteralPath (Join-Path $sibling '.git')) -and (Test-OriginOf $sibling $repo)) {
    return [pscustomobject]@{ Path = $sibling; From = 'sibling'; Exists = $true }
  }
  $clone = Join-Path (Get-ObjectiveHome) ".cache/deliver/checkouts/$repo"
  [pscustomobject]@{ Path = $clone; From = 'clone'; Exists = (Test-Path -LiteralPath (Join-Path $clone '.git')) }
}

function Get-ObjectiveKey($s) {
  $repos = @($s.repos | ForEach-Object { "$($_.repository)|$($_.status)|$($_.open)|$($_.closed)|$(@($_.ready | ForEach-Object { $_.number }) -join ',')" })
  $gates = @($s.gates | ForEach-Object { "$($_.type)|$($_.repository)|$($_.detail)" })
  "$($s.objective.state);$($repos -join ';');$($gates -join ';')"
}

# A repository waits only on a gate: an unmet Requires line, or only release-test items open.
function Test-GateWait($r) {
  if ($r.state -ne 'waiting') { return $false }
  if (@($r.requires | Where-Object { -not $_.met }).Count) { return $true }
  $w = @($r.waiting)
  $w.Count -gt 0 -and -not @($w | Where-Object { $_.reason -ne 'release test' }).Count
}

function Get-ObjectiveStop($s) {
  if ([string]$s.objective.state -eq 'closed') { return 'done' }
  $repos = @($s.repos)
  if (@($repos | Where-Object { $_.state -eq 'ready' }).Count) { return $null }
  $open = @($repos | Where-Object { $_.state -ne 'done' })
  if (-not $repos.Count) { return 'blocked' }
  if (-not @($open | Where-Object { -not (Test-GateWait $_) }).Count) { return 'gated' }
  'blocked'
}

function Write-NeedsYou($s) {
  $ref = "$($s.objective.repository)#$($s.objective.number)"
  $lines = @(foreach ($g in @($s.gates)) {
      switch ($g.type) {
        'release-pr' { "merge the release PR of $($g.repository): $($g.url)" }
        'rc-missing' { "RC test $($g.detail)$(if ($g.url) { ": $($g.url)" })" }
        'not-released' { "release $($g.detail)" }
      }
    })
  if (-not @($s.repos | Where-Object { $_.state -ne 'done' }).Count) {
    $lines += "check the acceptance criteria of $ref and close the objective: $($s.objective.url)"
  }
  Write-Step 'needs you:' 'yellow'
  $n = 0
  foreach ($l in $lines) { $n++; Write-Step "  $n. $l" 'yellow' }
}

function Invoke-ObjectiveLoop {
  param([string]$Ref, [int]$Max, [string]$Harness, [string]$Model, [switch]$DryRun, [switch]$NoPreflight, [switch]$NoColor)
  if ($Ref -notmatch '^([^/\s#]+/[^/\s#]+)#([0-9]+)$') {
    [Console]::Error.WriteLine("-Objective must be <owner>/<repo>#<nr>, got '$Ref'.")
    return 64
  }
  $objRepo = $Matches[1]; $objNr = [int]$Matches[2]
  $top = @(& git rev-parse --show-toplevel 2>$null)[0]
  $telos = if ($LASTEXITCODE -eq 0 -and $top) { [IO.Path]::GetFullPath($top) } else { (Get-Location).Path }
  $statusScript = Join-Path $PSScriptRoot 'Get-ObjectiveStatus.ps1'
  $preflight = Join-Path $PSScriptRoot 'Test-DeliverPreflight.ps1'
  $loop = Join-Path $PSScriptRoot 'Invoke-DeliverLoop.ps1'
  $round = 0; $prev = $null; $result = $null; $s = $null
  while (-not $result) {
    # a closed objective ends the run before the walk over its repositories (one REST GET)
    $obj = try { (@(& gh api "repos/$objRepo/issues/$objNr" 2>$null) -join "`n") | ConvertFrom-Json } catch { $null }
    if ($obj -and [string]$obj.state -eq 'closed') { $result = 'done'; break }
    $s = Read-ObjectiveStatus $statusScript $Ref
    if (-not $s) { Write-Step "objective status of $Ref not read" 'red'; $result = 'no progress'; break }
    $result = Get-ObjectiveStop $s
    if ($result) { break }
    $key = Get-ObjectiveKey $s
    if ($null -ne $prev -and $key -eq $prev) { $result = 'no progress'; Write-Step 'no progress: the objective state did not change in the last round' 'yellow'; break }
    $prev = $key
    $round++
    $targets = Get-ObjectiveTargets $objRepo $objNr
    foreach ($r in @($s.repos | Where-Object { $_.state -eq 'ready' })) {
      $repo = [string]$r.repository
      $nrs = @($targets[$repo] | Where-Object { $_ })
      if (-not $nrs.Count) { $nrs = @($r.ready | ForEach-Object { [int]$_.number }) }
      $co = Resolve-Checkout $repo $objRepo $telos
      $cmd = "deliver-loop -Target $($nrs -join ',')$(if ($Max -gt 0) { " -Max $Max" })"
      $verb = if ($DryRun) { 'would start' } else { 'start' }
      $clone = if ($co.From -eq 'clone' -and -not $co.Exists) { ', fresh clone' } else { '' }
      Write-Step "round ${round}: $repo $verb $cmd in $($co.Path) ($($co.From)$clone)" 'cyan'
      if ($DryRun) { continue }
      if (-not $co.Exists) {
        New-Item -ItemType Directory -Force -Path (Split-Path $co.Path -Parent) | Out-Null
        & gh repo clone $repo $co.Path 2>&1 | ForEach-Object { Write-Step "[$repo] $_" }
        if ($LASTEXITCODE -ne 0) { Write-Step "[$repo] clone failed, skipped" 'red'; continue }
      }
      Push-Location -LiteralPath $co.Path
      try {
        if (-not $NoPreflight) {
          # the repository's own allowlist; unattended: print the lines and go on (references/preflight.md)
          try {
            & $preflight -ProjectRoot $co.Path -Harness $Harness -Unattended -Text -Check @('skills', 'allowlist', 'worktrees') 2>&1 |
              ForEach-Object { Write-Step "[$repo] $_" }
          } catch { Write-Step "[$repo] preflight failed: $_" 'yellow' }
        }
        $cli = @('-NoProfile', '-File', $loop, '-Target', ($nrs -join ','), '-Harness', $Harness)
        if ($Max -gt 0) { $cli += @('-Max', [string]$Max) }
        if ($Model -and -not ($Harness -eq 'copilot' -and $Model -eq 'auto')) { $cli += @('-Model', $Model) }
        if ($NoColor) { $cli += '-NoColor' }
        & pwsh @cli 2>&1 | ForEach-Object { Write-Host "  [$repo] $_" }
        Write-Step "[$repo] loop exit $LASTEXITCODE"
      } finally { Pop-Location }
    }
    if ($DryRun) { $result = 'dry run'; break }
  }
  $code = switch ($result) { 'done' { 0 } 'dry run' { 0 } 'gated' { 3 } 'blocked' { 2 } default { 1 } }
  if ($s) {
    foreach ($r in @($s.repos)) { Write-Step "$($r.repository): $($r.closed)/$($r.open + $r.closed) $($r.status)" }
  }
  if ($result -eq 'gated') { Write-NeedsYou $s }
  $color = if ($result -in 'done', 'dry run') { 'green' } else { 'yellow' }
  Write-Step "objective result: $result ($round round(s))" $color
  if ($result -ne 'dry run') { Send-Notice "objective $Ref`: $result" }
  return $code
}
