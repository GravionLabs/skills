<#
.SYNOPSIS
  Mode -Objective of Invoke-DeliverLoop.ps1 (dot-sourced, no script of its own): rounds over the ready repositories of an [Objective].
.DESCRIPTION
  One round reads Get-ObjectiveStatus.ps1 (REST GET only), starts in every repository with state `ready` the loop
  `Invoke-DeliverLoop.ps1 -Target <open sub-issues of the objective in that repo> [-Max <k>]` in the checkout of that
  repository (deliver.parallel of .agents/config.json, default 1: one after the other; n > 1: up to n repositories at the
  same time, one loop per repository, the round waits for all), and reads the state again. Each round logs its results
  per repository and its REST/GraphQL usage (`gh api rate_limit` before and after). State only from GitHub: an
  aborted round resumes with the same command. Never closes the objective; its only own writes are the two rules between
  rounds (#545): contract-change pauses the downstream children (needs-refinement + comment), a finished milestone with a
  waiting `rc` edge runs `/deliver --milestone <M>` (step 9) in the upstream checkout.
  Checkout of <owner>/<repo>: the objective's own repository is the current checkout; else an entry of
  ~/.config/deliver/checkouts.json ({ "<owner/repo>": "<path>" }), else the sibling folder <root>/<repo> of the current
  checkout (its origin must be <owner>/<repo>), else a fresh `gh repo clone` into ~/.cache/deliver/checkouts/<owner>/<repo>.
  Results: done (objective closed, 0), gated (only release gates or the acceptance of the criteria open; prints
  "needs you", 3), blocked (2), no progress (a round without change, 1), handed over (a foreign live runner marker, 4),
  released (a release request of Set-ObjectiveRunner.ps1, 0); -DryRun prints the first round and exits 0.
  Runner (ObjectiveRunner.ps1): at the start the marker comment is set (a foreign live one hands over), a heartbeat
  thread refreshes it every $env:DELIVER_OBJECTIVE_HEARTBEAT_SECONDS (default 600), and before every round and every
  repository the marker and the release request are checked; handover and release happen only at these boundaries.
#>

. (Join-Path $PSScriptRoot 'ObjectiveRunner.ps1')

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

# gh api write with a JSON body on stdin; $true on success.
function Invoke-ObjectiveWrite([string]$method, [string]$path, $body) {
  ($body | ConvertTo-Json -Compress) | & gh api -X $method $path --input - 2>&1 | Out-Null
  $LASTEXITCODE -eq 0
}

function Get-ObjectiveRest([string]$path) {
  $raw = & gh api $path --paginate --slurp 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) { return @() }
  $out = @()
  $pages = ($raw -join "`n") | ConvertFrom-Json -NoEnumerate
  foreach ($page in @($pages)) { $out += @($page) }
  $out
}

# ConvertFrom-Json turns ISO timestamps into DateTime; a string stays one: both as UTC.
function ConvertTo-UtcTime($v) {
  if ($v -is [DateTime]) { return $v.ToUniversalTime() }
  [DateTime]::Parse([string]$v, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal -bor [Globalization.DateTimeStyles]::AdjustToUniversal)
}

# Rule 1 (#545, #570): a merged PR whose closed PBI issue carries the label contract-change (deliver step 6 labels the issue,
# not the PR; a label on the PR counts too), merged since $since in a repository of the objective -> the open
# downstream children (their repository `Requires:` the PR's repository, or they are blocked by the issue the PR closes)
# get needs-refinement and a comment with the PR link. $handled (PR keys) makes a PR count once per run. Returns the paused refs.
function Invoke-ContractPause($s, [DateTime]$since, [hashtable]$handled, [switch]$DryRun) {
  $paused = @()
  foreach ($up in @($s.repos)) {
    $upRepo = [string]$up.repository
    $prs = @(Get-ObjectiveRest "repos/$upRepo/pulls?state=closed&sort=updated&direction=desc&per_page=30" | Where-Object {
        $_ -and $_.merged_at -and (ConvertTo-UtcTime $_.merged_at) -ge $since -and -not $handled["$upRepo#$($_.number)"]
      })
    foreach ($pr in $prs) {
      $closes = @([regex]::Matches([string]$pr.body, '(?i)\b(?:closes|fixes|resolves)\s+(?:([\w.-]+/[\w.-]+))?#(\d+)') |
          ForEach-Object { "$(if ($_.Groups[1].Value) { $_.Groups[1].Value } else { $upRepo })#$($_.Groups[2].Value)" })
      # deliver step 6 labels the PBI issue the PR closes; the PR's own label counts too
      $hit = [bool]@($pr.labels | Where-Object { $_.name -eq 'contract-change' }).Count
      foreach ($c in $closes) {
        if ($hit) { break }
        $cRepo, $cNr = $c -split '#'
        $iss = @(Get-ObjectiveRest "repos/$cRepo/issues/$cNr")[0]
        if ($iss -and @($iss.labels | Where-Object { $_.name -eq 'contract-change' }).Count) { $hit = $true }
      }
      if (-not $hit) { continue }
      $handled["$upRepo#$($pr.number)"] = $true
      foreach ($r in @($s.repos)) {
        $viaRequires = [bool]@(@($r.requires) | Where-Object { $_ -and [string]$_.repository -eq $upRepo }).Count
        $items = @(@($r.ready) + @($r.waiting) | Where-Object { $_ -and [string]$_.reason -notin 'release test', 'needs-refinement', 'needs-decision' })
        foreach ($i in $items) {
          $isDown = $viaRequires
          if (-not $isDown -and $closes.Count) {
            $deps = @(Get-ObjectiveRest "repos/$($r.repository)/issues/$($i.number)/dependencies/blocked_by?per_page=100")
            foreach ($d in $deps) {
              $dRepo = if ($d.repository_url) { [string]$d.repository_url -replace '^.*/repos/', '' } else { [string]$r.repository }
              if ($closes -contains "$dRepo#$($d.number)") { $isDown = $true }
            }
          }
          if (-not $isDown) { continue }
          $ref = "$($r.repository)#$($i.number)"
          if ($DryRun) { Write-Step "would pause $ref (needs-refinement): contract-change $($pr.html_url)" 'cyan'; $paused += $ref; continue }
          $ok = (Invoke-ObjectiveWrite 'POST' "repos/$($r.repository)/issues/$($i.number)/labels" @{ labels = @('needs-refinement') }) -and
          (Invoke-ObjectiveWrite 'POST' "repos/$($r.repository)/issues/$($i.number)/comments" @{ body = "Paused by deliver-loop: the upstream change $($pr.html_url) carries ``contract-change``. Refine this item against the new contract (``planner refine $($i.number)``), then remove ``needs-refinement``." })
          if ($ok) { Write-Step "paused $ref (needs-refinement): contract-change $($pr.html_url)" 'yellow'; $paused += $ref }
          else { Write-Step "pause of $ref failed" 'red' }
        }
      }
    }
  }
  $paused
}

# #546: the context file of a downstream repository: the PRs merged since $since in the repositories it `Requires:` (link, title,
# diff stat), so the fix subagent sees causes in other repos. Returns the file path, or '' when there is nothing to say.
function Write-ContextFile($s, $r, [string]$checkout, [DateTime]$since) {
  $lines = @()
  foreach ($up in @($r.requires | Where-Object { $_ } | ForEach-Object { [string]$_.repository } | Select-Object -Unique)) {
    $prs = @(Get-ObjectiveRest "repos/$up/pulls?state=closed&sort=updated&direction=desc&per_page=30" | Where-Object {
        $_ -and $_.merged_at -and (ConvertTo-UtcTime $_.merged_at) -ge $since })
    foreach ($pr in $prs) {
      $d = @(Get-ObjectiveRest "repos/$up/pulls/$($pr.number)")[0]
      $stat = if ($d -and $null -ne $d.changed_files) { "$($d.changed_files) files, +$($d.additions) -$($d.deletions)" } else { 'diff stat n/a' }
      $lines += "- $up#$($pr.number) $($pr.html_url) $([string]$pr.title -replace '[\r\n]+', ' ') ($stat)"
    }
  }
  if (-not $lines.Count) { return '' }
  $file = Join-Path $checkout '.agents/deliver-loop/context.md'
  New-Item -ItemType Directory -Force -Path (Split-Path $file -Parent) | Out-Null
  Set-Content -LiteralPath $file -Value (@("Upstream PRs merged since $($since.ToString('u')) in the repositories of $($r.repository)'s Requires:") + $lines) -Encoding utf8
  $file
}

# Rule 2 (#545): an unmet `Requires: <repo>@<M> rc` whose milestone is finished (no open `pbi` or `bug` but the release-test one, as deliver step 9)
# and whose release-test issue exists -> /deliver --milestone <M> in the upstream checkout, once per run. It reaches step 9
# (cut the RC, post it); the release PR stays a human gate (deliver never merges it).
function Invoke-RcTriggers($s, [string]$objRepo, [string]$telos, [string]$Harness, [string]$Model, [hashtable]$triggered, [switch]$DryRun) {
  $started = @()
  $edges = @($s.repos | ForEach-Object { @($_.requires) } | Where-Object { $_ -and $_.kind -eq 'rc' -and -not $_.met -and [string]$_.milestoneState -eq 'open' -and $_.releaseTest })
  foreach ($e in @($edges | Sort-Object { "$($_.repository)@$($_.milestone)" } -Unique)) {
    $key = "$($e.repository)@$($e.milestone)"
    if ($triggered[$key]) { continue }
    $norm = { param($t) if ($t -match '^M([0-9]+(?:\.[0-9]+)*)(?=\s|\(|$)') { 'M' + ((@($Matches[1] -split '\.' | ForEach-Object { [string][int]$_ })) -join '.') } else { $null } }
    $want = & $norm ([string]$e.milestone)
    $m = @(Get-ObjectiveRest "repos/$($e.repository)/milestones?state=all&per_page=100" |
        Where-Object { $_ -and ($_.title -eq $e.milestone -or ($want -and (& $norm ([string]$_.title)) -eq $want)) })[0]
    if (-not $m) { continue }
    $open = @(Get-ObjectiveRest "repos/$($e.repository)/issues?milestone=$($m.number)&state=open&per_page=100" | Where-Object {
        $names = @($_.labels | ForEach-Object { $_.name })
        $_ -and -not $_.pull_request -and ($names -contains 'pbi' -or $names -contains 'bug') -and $names -notcontains 'release-test' })
    if ($open.Count) { continue }
    $triggered[$key] = $true
    $co = Resolve-Checkout ([string]$e.repository) $objRepo $telos
    $prompt = "/deliver --milestone $($e.milestone) --unattended --max 1"
    Write-Step "$(if ($DryRun) { 'would run' } else { 'run' }) rc trigger: $($e.repository) $prompt in $($co.Path) ($($co.From)); the release PR stays yours" 'cyan'
    $started += $key
    if ($DryRun) { continue }
    if (-not $co.Exists) {
      New-Item -ItemType Directory -Force -Path (Split-Path $co.Path -Parent) | Out-Null
      & gh repo clone $e.repository $co.Path 2>&1 | ForEach-Object { Write-Step "[$($e.repository)] $_" }
      if ($LASTEXITCODE -ne 0) { Write-Step "[$($e.repository)] clone failed, rc trigger skipped" 'red'; continue }
    }
    Push-Location -LiteralPath $co.Path
    try {
      $mdl = if ($Model) { $Model } else { 'sonnet' }
      $cli = if ($Harness -eq 'copilot') { @('-p', $prompt, '--model', $mdl, '--allow-all-tools', '--allow-all-paths', '--allow-all-urls', '--no-ask-user') }
      else { @('-p', $prompt, '--model', $mdl, '--permission-mode', 'auto') }
      & $Harness @cli 2>&1 | ForEach-Object { Write-Host "  [$($e.repository)] $_" }
      Write-Step "[$($e.repository)] rc trigger exit $LASTEXITCODE"
    } finally { Pop-Location }
  }
  $started
}

# deliver.parallel of .agents/config.json in $root: how many repository loops a round runs at the same time (default 1).
function Get-DeliverParallel([string]$root) {
  $f = Join-Path $root '.agents/config.json'
  if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { return 1 }
  $v = try { (Get-Content -LiteralPath $f -Raw | ConvertFrom-Json -AsHashtable).deliver.parallel } catch { $null }
  if ($null -eq $v) { return 1 }
  if ($v -is [long] -or $v -is [int]) { if ($v -ge 1) { return [int]$v } }
  Write-Step "deliver.parallel must be an integer >= 1, got '$v': 1" 'yellow'
  1
}

# The used counters of the token's REST (core) and GraphQL rate limits (`gh api rate_limit` itself is not counted), or $null.
function Get-ApiUsage {
  $raw = & gh api rate_limit 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $raw) { return $null }
  $r = try { ($raw -join "`n") | ConvertFrom-Json } catch { $null }
  if (-not $r -or -not $r.resources) { return $null }
  [pscustomobject]@{
    Rest = [int]$r.resources.core.used; RestLeft = [int]$r.resources.core.remaining
    Graphql = [int]$r.resources.graphql.used; GraphqlLeft = [int]$r.resources.graphql.remaining
  }
}

# One step-log line per round with the API calls of the round (all processes of the token, so the pilot measures the round).
function Write-ApiUsage([int]$round, $before, $after) {
  if (-not $before -or -not $after) { Write-Step "round $round api: n/a (rate_limit not read)"; return }
  $rest = $after.Rest - $before.Rest; $gql = $after.Graphql - $before.Graphql
  if ($rest -lt 0 -or $gql -lt 0) { Write-Step "round $round api: n/a (rate-limit window reset)"; return }
  Write-Step "round $round api: rest +$rest, graphql +$gql (remaining rest $($after.RestLeft), graphql $($after.GraphqlLeft))"
}

# Exit code of a repository loop (Invoke-DeliverLoop.ps1) as the word of the round results.
function Get-RepoLoopLabel([int]$code) {
  switch ($code) { 0 { 'done' } 1 { 'no progress' } 2 { 'blocked' } -1 { 'clone failed' } default { "failed ($code)" } }
}

# deliver.parallel > 1: runs the prepared repository loops ($jobs: Repo, Path, Cli) as thread jobs, at most $limit at a time,
# streams their output with the [repo] prefix and waits for all. The heartbeat stops every running checkout ($shared.Checkout);
# running.json lists them for `deliver-loop release`. Returns {Repo, Exit} per repository in the order they ended.
function Invoke-RepoLoopsParallel($jobs, [int]$limit, [hashtable]$shared, [string]$objRepo, [int]$objNr, [string]$hostId) {
  $queue = [System.Collections.Generic.Queue[object]]::new()
  foreach ($j in $jobs) { $queue.Enqueue($j) }
  $running = [System.Collections.Generic.List[object]]::new()
  $done = @()
  $flush = {
    param($run)
    foreach ($line in @(Receive-Job -Job $run.Job)) {
      if ("$line" -match '^@@exit (-?\d+)$') { $run.Exit = [int]$Matches[1] } else { Write-Host "$line" }
    }
  }
  while ($queue.Count -or $running.Count) {
    $started = $false
    while ($queue.Count -and $running.Count -lt $limit) {
      $j = $queue.Dequeue()
      $jobPath = [string]$j.Path; $jobCli = [string[]]$j.Cli; $jobRepo = [string]$j.Repo
      $job = Start-ThreadJob -ScriptBlock {
        $cli = $using:jobCli; $repo = $using:jobRepo
        Set-Location -LiteralPath $using:jobPath
        & pwsh @cli 2>&1 | ForEach-Object { "  [$repo] $_" }
        "@@exit $LASTEXITCODE"
      }
      $running.Add([pscustomobject]@{ Repo = $j.Repo; Path = $j.Path; Job = $job; Exit = $null })
      $started = $true
    }
    if ($started) {
      $paths = @($running | ForEach-Object { $_.Path })
      $shared.Checkout = $paths
      Set-LocalRunner $objRepo $objNr $hostId $paths
    }
    foreach ($run in @($running)) {
      & $flush $run
      if ($run.Job.State -in 'Completed', 'Failed', 'Stopped') {
        & $flush $run
        Remove-Job -Job $run.Job -Force
        [void]$running.Remove($run)
        $done += [pscustomobject]@{ Repo = $run.Repo; Exit = $(if ($null -ne $run.Exit) { $run.Exit } else { 1 }) }
      }
    }
    if ($running.Count) { Start-Sleep -Milliseconds 200 }
  }
  $done
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
  $parallel = Get-DeliverParallel $telos
  if ($parallel -gt 1) { Write-Step "deliver.parallel ${parallel}: up to $parallel repository loops at a time, one per repository" }
  $since = ([DateTime]::UtcNow.AddSeconds(-1)); $handled = @{}; $triggered = @{}
  $lastGreen = @{}; $ctxStart = [DateTime]::UtcNow.AddDays(-7)
  $hostId = Get-RunnerHostId
  $shared = [hashtable]::Synchronized(@{ Stop = $false; Foreign = $null; Checkout = $telos })
  $releaseFile = Join-Path (Get-RunnerStateDir $objRepo $objNr) 'release'
  $used = [System.Collections.Generic.List[string]]::new(); $used.Add($telos)
  $runner = $null; $hb = $null; $shared.Fresh = $true
  if (-not $DryRun) {
    $local = Get-LocalRunner $objRepo $objNr
    if ($local -and [int]$local.pid -ne $PID) {
      Write-Step "runner: $Ref already runs on this host (pid $($local.pid))" 'yellow'
      $result = 'handed over'
    } else {
      Remove-Item -LiteralPath $releaseFile -Force -ErrorAction SilentlyContinue
      $runner = Enter-ObjectiveRunner $objRepo $objNr $hostId
      switch ($runner.Action) {
        'error' { Write-Step "runner marker of $Ref not read or written" 'red'; $result = 'no progress' }
        'handed over' { Write-Step "runner: $Ref runs on $($runner.Holder.Host) (heartbeat $($runner.Holder.Heartbeat))" 'yellow'; $result = 'handed over' }
        'took over' { Write-Step "runner: $hostId took over the dead marker of $($runner.Holder.Host) (heartbeat $($runner.Holder.Heartbeat))" 'yellow' }
        default { Write-Step "runner: $hostId since $($runner.Since)" }
      }
      if (-not $result) {
        Set-LocalRunner $objRepo $objNr $hostId $telos
        $secs = if ([int]$env:DELIVER_OBJECTIVE_HEARTBEAT_SECONDS -gt 0) { [int]$env:DELIVER_OBJECTIVE_HEARTBEAT_SECONDS } else { 600 }
        $hb = Start-RunnerHeartbeat $objRepo $objNr $hostId $runner.Since $shared $secs
      }
    }
  }
  # a round boundary: a foreign marker hands over, a release request releases; $null goes on
  function Test-RunnerBoundary {
    if ($DryRun -or $shared.Fresh) { return $null }
    $st = Get-RunnerState $objRepo $objNr $hostId
    if ($st.State -eq 'foreign' -or ($shared.Foreign -and $st.State -ne 'own')) {
      $holder = if ($st.Holder) { $st.Holder.Host } else { $shared.Foreign }
      Write-Step "runner: $Ref was taken over by ${holder}: handed over" 'yellow'
      return 'handed over'
    }
    if (Test-Path -LiteralPath $releaseFile) {
      Write-Step "runner: release of $Ref requested" 'cyan'
      $id = if ($st.State -eq 'own') { $st.Id } else { $runner.Id }
      foreach ($l in (Invoke-RunnerRelease $objRepo $objNr $Ref $hostId $id @($used) $statusScript)) { Write-Step "runner: $l" }
      Remove-Item -LiteralPath $releaseFile -Force -ErrorAction SilentlyContinue
      return 'released'
    }
    if ($st.State -eq 'missing') { $runner.Id = Write-RunnerMarker $objRepo $objNr $null $hostId $runner.Since }
    $shared.Fresh = $true
    $null
  }
  try {
    while (-not $result) {
      $apiBefore = if ($DryRun) { $null } else { Get-ApiUsage }
      $result = Test-RunnerBoundary
      if ($result) { break }
      # a closed objective ends the run before the walk over its repositories (one REST GET)
      $obj = try { (@(& gh api "repos/$objRepo/issues/$objNr" 2>$null) -join "`n") | ConvertFrom-Json } catch { $null }
      if ($obj -and [string]$obj.state -eq 'closed') { $result = 'done'; break }
      $s = Read-ObjectiveStatus $statusScript $Ref
      if (-not $s) { Write-Step "objective status of $Ref not read" 'red'; $result = 'no progress'; break }
      if ([string]$s.objective.state -ne 'closed') {
        # rule 1: contract-change merged since the last round pauses the downstream children; rule 2: an rc edge on a finished milestone
        $paused = @(Invoke-ContractPause $s $since $handled -DryRun:$DryRun)
        $rc = @(Invoke-RcTriggers $s $objRepo $telos $Harness $Model $triggered -DryRun:$DryRun)
        if (($paused.Count -or $rc.Count) -and -not $DryRun) {
          $s = Read-ObjectiveStatus $statusScript $Ref
          if (-not $s) { Write-Step "objective status of $Ref not read" 'red'; $result = 'no progress'; break }
        }
      }
      $result = Get-ObjectiveStop $s
      if ($result) { break }
      $key = Get-ObjectiveKey $s
      if ($null -ne $prev -and $key -eq $prev) { $result = 'no progress'; Write-Step 'no progress: the objective state did not change in the last round' 'yellow'; break }
      $prev = $key
      $round++
      $since = ([DateTime]::UtcNow.AddSeconds(-1))
      $targets = Get-ObjectiveTargets $objRepo $objNr
      $results = @(); $jobs = @()
      foreach ($r in @($s.repos | Where-Object { $_.state -eq 'ready' })) {
        $repo = [string]$r.repository
        $nrs = @($targets[$repo] | Where-Object { $_ })
        if (-not $nrs.Count) { $nrs = @($r.ready | ForEach-Object { [int]$_.number }) }
        $result = Test-RunnerBoundary
        if ($result) { break }
        $co = Resolve-Checkout $repo $objRepo $telos
        $cmd = "deliver-loop -Target $($nrs -join ',')$(if ($Max -gt 0) { " -Max $Max" })"
        $verb = if ($DryRun) { 'would start' } else { 'start' }
        $clone = if ($co.From -eq 'clone' -and -not $co.Exists) { ', fresh clone' } else { '' }
        Write-Step "round ${round}: $repo $verb $cmd in $($co.Path) ($($co.From)$clone)" 'cyan'
        if ($DryRun) { continue }
        if (-not $co.Exists) {
          New-Item -ItemType Directory -Force -Path (Split-Path $co.Path -Parent) | Out-Null
          & gh repo clone $repo $co.Path 2>&1 | ForEach-Object { Write-Step "[$repo] $_" }
          if ($LASTEXITCODE -ne 0) { Write-Step "[$repo] clone failed, skipped" 'red'; $results += [pscustomobject]@{ Repo = $repo; Exit = -1 }; continue }
        }
        if (-not $used.Contains($co.Path)) { $used.Add($co.Path) }
        if ($parallel -le 1) {
          $shared.Checkout = $co.Path
          Set-LocalRunner $objRepo $objNr $hostId $co.Path
          $shared.Fresh = $false
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
          # #546: the upstream PRs since the last green run of this repository (first round: the last 7 days)
          $ctxSince = if ($lastGreen.ContainsKey($repo)) { $lastGreen[$repo] } else { $ctxStart }
          $roundStart = [DateTime]::UtcNow
          $ctx = Write-ContextFile $s $r $co.Path $ctxSince
          if ($ctx) { $cli += @('-Context', $ctx); Write-Step "[$repo] context file $ctx" }
          if ($Max -gt 0) { $cli += @('-Max', [string]$Max) }
          if ($Model -and -not ($Harness -eq 'copilot' -and $Model -eq 'auto')) { $cli += @('-Model', $Model) }
          if ($NoColor) { $cli += '-NoColor' }
          if ($parallel -gt 1) {
            $jobs += [pscustomobject]@{ Repo = $repo; Path = $co.Path; Cli = $cli; Start = $roundStart }
            continue
          }
          # deliver.parallel 1: one repository after the other, its output streamed as it comes
          & pwsh @cli 2>&1 | ForEach-Object { Write-Host "  [$repo] $_" }
          $results += [pscustomobject]@{ Repo = $repo; Exit = $LASTEXITCODE }
          Write-Step "[$repo] loop exit $LASTEXITCODE"
          if ($LASTEXITCODE -eq 0) { $lastGreen[$repo] = $roundStart }
        } finally { Pop-Location }
      }
      if ($jobs.Count -and -not $result) {
        # deliver.parallel > 1: the repository loops run concurrently (at most $parallel at a time); the round waits for all
        $shared.Fresh = $false
        foreach ($res in @(Invoke-RepoLoopsParallel $jobs $parallel $shared $objRepo $objNr $hostId)) {
          $results += $res
          Write-Step "[$($res.Repo)] loop exit $($res.Exit)"
          if ($res.Exit -eq 0) { $lastGreen[$res.Repo] = @($jobs | Where-Object { $_.Repo -eq $res.Repo })[0].Start }
        }
      }
      if ($results.Count) {
        Write-Step "round ${round} results: $(@($results | ForEach-Object { "$($_.Repo) $(Get-RepoLoopLabel $_.Exit)" }) -join ', ')"
        Write-ApiUsage $round $apiBefore (Get-ApiUsage)
      }
      if ($result) { break }
      if ($DryRun) { $result = 'dry run'; break }
    }
  } finally {
    Stop-RunnerHeartbeat $hb $shared
    $local = Get-LocalRunner $objRepo $objNr
    if ($runner -and $local -and [int]$local.pid -eq $PID) { Remove-Item -LiteralPath (Join-Path (Get-RunnerStateDir $objRepo $objNr) 'running.json') -Force -ErrorAction SilentlyContinue }
  }
  $code = switch ($result) { 'done' { 0 } 'dry run' { 0 } 'released' { 0 } 'gated' { 3 } 'blocked' { 2 } 'handed over' { 4 } default { 1 } }
  if ($s) {
    foreach ($r in @($s.repos)) { Write-Step "$($r.repository): $($r.closed)/$($r.open + $r.closed) $($r.status)" }
  }
  if ($result -eq 'gated') { Write-NeedsYou $s }
  $color = if ($result -in 'done', 'dry run', 'released') { 'green' } else { 'yellow' }
  Write-Step "objective result: $result ($round round(s))" $color
  if ($result -ne 'dry run') { Send-Notice "objective $Ref`: $result" }
  return $code
}
