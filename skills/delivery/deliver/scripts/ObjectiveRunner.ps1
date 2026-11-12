<#
.SYNOPSIS
  Runner marker of an [Objective] (dot-sourced by ObjectiveLoop.ps1, Set-ObjectiveRunner.ps1 and the heartbeat thread).
.DESCRIPTION
  One comment per Objective holds `<!-- objective-runner: host=<id> since=<iso> heartbeat=<iso> -->` (github-issue
  references/objectives.md, "Runner marker"); it is replaced in place (PATCH), never a second one. A marker whose heartbeat
  is older than 30 minutes is dead. The host id is $env:DELIVER_RUNNER_HOST, else the machine name. Local state of a
  running objective loop: ~/.cache/deliver/objectives/<owner>/<repo>/<nr>/running.json ({pid, host, checkout}) and the
  file `release` (a release request of Set-ObjectiveRunner.ps1). GitHub access only through `gh api`.
#>

$RunnerDeadMinutes = 30
$RunnerMarkerPattern = '<!--\s*objective-runner:\s*host=(\S+)\s+since=(\S+)\s+heartbeat=(\S+)\s*-->'

function Get-RunnerHostId { if ($env:DELIVER_RUNNER_HOST) { $env:DELIVER_RUNNER_HOST } else { [Environment]::MachineName } }

function Get-RunnerNow { (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ') }

function Format-RunnerMarker([string]$hostId, [string]$since, [string]$heartbeat) {
  "<!-- objective-runner: host=$hostId since=$since heartbeat=$heartbeat -->`nThis objective is run by ``$hostId`` since $since (heartbeat $heartbeat)."
}

# {Host, Since, Heartbeat (string), Age (minutes, [double]::MaxValue when unreadable)} or $null
function ConvertFrom-RunnerMarker([string]$text) {
  if ($text -notmatch $RunnerMarkerPattern) { return $null }
  $age = [double]::MaxValue
  $beat = [DateTimeOffset]::MinValue
  if ([DateTimeOffset]::TryParse($Matches[3], [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$beat)) {
    $age = ([DateTimeOffset]::UtcNow - $beat).TotalMinutes
  }
  [pscustomobject]@{ Host = $Matches[1]; Since = $Matches[2]; Heartbeat = $Matches[3]; Age = $age }
}

function Test-RunnerLive($marker) { $marker -and $marker.Age -lt $RunnerDeadMinutes }

# The marker comment of the objective: {Ok, Id, Marker}; Ok $false when the comments could not be read.
function Get-RunnerComment([string]$repo, [int]$nr) {
  $global:LASTEXITCODE = 0
  $raw = try { & gh api "repos/$repo/issues/$nr/comments?per_page=100" --paginate --slurp 2>$null } catch { $null }
  if ($LASTEXITCODE -ne 0 -or -not $raw) { return [pscustomobject]@{ Ok = $false; Id = $null; Marker = $null } }
  $pages = try { ($raw -join "`n") | ConvertFrom-Json -NoEnumerate } catch { $null }
  if ($null -eq $pages) { return [pscustomobject]@{ Ok = $false; Id = $null; Marker = $null } }
  foreach ($page in @($pages)) {
    foreach ($c in @($page)) {
      $m = if ($c) { ConvertFrom-RunnerMarker ([string]$c.body) } else { $null }
      if ($m) { return [pscustomobject]@{ Ok = $true; Id = $c.id; Marker = $m } }
    }
  }
  [pscustomobject]@{ Ok = $true; Id = $null; Marker = $null }
}

# Replaces the marker comment in place (PATCH) or, without one, creates it (POST). Returns the comment id or $null.
function Write-RunnerMarker([string]$repo, [int]$nr, $id, [string]$hostId, [string]$since) {
  $body = Format-RunnerMarker $hostId $since (Get-RunnerNow)
  $global:LASTEXITCODE = 0
  $out = if ($id) {
    try { & gh api -X PATCH "repos/$repo/issues/comments/$id" -f "body=$body" 2>$null } catch { $null }
  } else {
    try { & gh api -X POST "repos/$repo/issues/$nr/comments" -f "body=$body" 2>$null } catch { $null }
  }
  if ($LASTEXITCODE -ne 0) { return $null }
  $new = try { (($out -join "`n") | ConvertFrom-Json).id } catch { $null }
  if ($new) { $new } else { $id }
}

function Remove-RunnerMarker([string]$repo, $id) {
  $global:LASTEXITCODE = 0
  try { & gh api -X DELETE "repos/$repo/issues/comments/$id" 2>$null | Out-Null } catch { $global:LASTEXITCODE = 1 }
  $LASTEXITCODE -eq 0
}

# Start of a runner: {Action (start, took over, handed over, error), Id, Holder, Since}. A foreign live marker hands over.
function Enter-ObjectiveRunner([string]$repo, [int]$nr, [string]$hostId, [switch]$Force) {
  $c = Get-RunnerComment $repo $nr
  if (-not $c.Ok) { return [pscustomobject]@{ Action = 'error'; Id = $null; Holder = $null; Since = $null } }
  $m = $c.Marker
  $foreign = $m -and $m.Host -ne $hostId
  if ($foreign -and (Test-RunnerLive $m) -and -not $Force) {
    return [pscustomobject]@{ Action = 'handed over'; Id = $c.Id; Holder = $m; Since = $null }
  }
  $since = Get-RunnerNow
  $id = Write-RunnerMarker $repo $nr $c.Id $hostId $since
  $action = if (-not $id) { 'error' } elseif ($foreign) { 'took over' } else { 'start' }
  [pscustomobject]@{ Action = $action; Id = $id; Holder = $m; Since = $since }
}

# State of the marker for this host: own, foreign (Holder set), missing or unknown (read failed).
function Get-RunnerState([string]$repo, [int]$nr, [string]$hostId) {
  $c = Get-RunnerComment $repo $nr
  $state = if (-not $c.Ok) { 'unknown' } elseif (-not $c.Marker) { 'missing' } elseif ($c.Marker.Host -eq $hostId) { 'own' } else { 'foreign' }
  [pscustomobject]@{ State = $state; Id = $c.Id; Holder = $c.Marker }
}

function Get-RunnerStateDir([string]$repo, [int]$nr) {
  $h = if ($env:HOME) { $env:HOME } else { $env:USERPROFILE }
  Join-Path $h ".cache/deliver/objectives/$repo/$nr"
}

# running.json of a live local objective loop (its pid alive) or $null.
function Get-LocalRunner([string]$repo, [int]$nr) {
  $f = Join-Path (Get-RunnerStateDir $repo $nr) 'running.json'
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return $null }
  $r = try { Get-Content -LiteralPath $f -Raw | ConvertFrom-Json } catch { $null }
  if (-not $r -or -not (Get-Process -Id ([int]$r.pid) -ErrorAction SilentlyContinue)) { return $null }
  $r
}

# $checkout: the checkouts whose repository loops run now (deliver.parallel > 1: several); `checkout` is the first of them.
function Set-LocalRunner([string]$repo, [int]$nr, [string]$hostId, [string[]]$checkout) {
  $dir = Get-RunnerStateDir $repo $nr
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $all = @($checkout | Where-Object { $_ })
  [IO.File]::WriteAllText((Join-Path $dir 'running.json'), ([ordered]@{ pid = $PID; host = $hostId; checkout = $all[0]; checkouts = $all } | ConvertTo-Json -Compress))
}

# Asks the running repository loop in $checkout to stop after its running PBI (stop file of Request-LoopStop.ps1).
function Request-RepoLoopStop([string]$checkout) {
  if (-not $checkout) { return $false }
  $latest = Join-Path $checkout '.agents/deliver-loop/latest.txt'
  if (-not (Test-Path -LiteralPath $latest -PathType Leaf)) { return $false }
  $run = (Get-Content -LiteralPath $latest -Raw).Trim()
  if (-not $run) { return $false }
  if (-not [IO.Path]::IsPathRooted($run)) { $run = Join-Path $checkout $run }
  $progress = Join-Path $run 'progress.jsonl'
  if (-not (Test-Path -LiteralPath $run -PathType Container)) { return $false }
  if ((Test-Path -LiteralPath $progress) -and (Select-String -LiteralPath $progress -Pattern '"event"\s*:\s*"result"' -Quiet)) { return $false }
  [IO.File]::WriteAllText((Join-Path $run 'stop'), '')
  $true
}

# Pushes every local branch with commits on no remote (not main, master, release/*) to origin: {Pushed, Failed}.
function Push-RunnerBranches([string]$checkout) {
  $pushed = @(); $failed = @()
  $branches = @(& git -C $checkout for-each-ref --format='%(refname:short)' refs/heads 2>$null | Where-Object { $_ -and $_ -notmatch '^(main|master|release/.*)$' })
  foreach ($b in $branches) {
    $ahead = @(& git -C $checkout rev-list --count $b --not --remotes 2>$null)[0]
    if ($LASTEXITCODE -ne 0 -or [int]$ahead -eq 0) { continue }
    & git -C $checkout push -u origin $b 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) { $pushed += $b } else { $failed += $b }
  }
  [pscustomobject]@{ Pushed = $pushed; Failed = $failed }
}

# Release: push the branches of the checkouts, post the status comment, delete the marker. Returns the lines to print.
function Invoke-RunnerRelease([string]$repo, [int]$nr, [string]$ref, [string]$hostId, $markerId, [string[]]$checkouts, [string]$statusScript) {
  $lines = @()
  foreach ($co in @($checkouts | Where-Object { $_ } | Select-Object -Unique)) {
    $p = Push-RunnerBranches $co
    if ($p.Pushed.Count) { $lines += "pushed in ${co}: $($p.Pushed -join ', ')" }
    if ($p.Failed.Count) { $lines += "push failed in ${co}: $($p.Failed -join ', ')" }
  }
  $global:LASTEXITCODE = 0
  $status = try { @(& $statusScript -Objective $ref -Text 2>$null) -join "`n" } catch { '' }
  $body = "Runner ``$hostId`` released this objective at $(Get-RunnerNow)."
  if ($status) { $body += "`n`n``````text`n$status`n``````" }
  & gh api -X POST "repos/$repo/issues/$nr/comments" -f "body=$body" 2>$null | Out-Null
  $lines += if ($LASTEXITCODE -eq 0) { 'status comment posted' } else { 'status comment failed' }
  $lines += if ($markerId -and (Remove-RunnerMarker $repo $markerId)) { 'runner marker released' } else { 'runner marker not released' }
  $lines
}

# The heartbeat timer: a thread that refreshes the marker every $Seconds while the repository loops run. A foreign marker
# sets $Shared.Foreign and asks the running repository loops ($Shared.Checkout, one path or several) to stop after their PBI.
function Start-RunnerHeartbeat([string]$repo, [int]$nr, [string]$hostId, [string]$since, [hashtable]$Shared, [int]$Seconds) {
  $module = Join-Path $PSScriptRoot 'ObjectiveRunner.ps1'
  Start-ThreadJob -ScriptBlock {
    . $using:module
    $repo = $using:repo; $nr = $using:nr; $hostId = $using:hostId; $since = $using:since; $shared = $using:Shared
    while (-not $shared.Stop) {
      $until = [DateTime]::UtcNow.AddSeconds($using:Seconds)
      while (-not $shared.Stop -and [DateTime]::UtcNow -lt $until) { Start-Sleep -Milliseconds 200 }
      if ($shared.Stop) { break }
      $s = Get-RunnerState $repo $nr $hostId
      if ($s.State -eq 'foreign') {
        $shared.Foreign = $s.Holder.Host
        foreach ($co in @($shared.Checkout)) { [void](Request-RepoLoopStop $co) }
        break
      }
      if ($s.State -eq 'own') { [void](Write-RunnerMarker $repo $nr $s.Id $hostId $since) }
    }
  }
}

function Stop-RunnerHeartbeat($job, [hashtable]$Shared) {
  if (-not $job) { return }
  $Shared.Stop = $true
  $job | Wait-Job -Timeout 5 | Out-Null
  $job | Remove-Job -Force
}
