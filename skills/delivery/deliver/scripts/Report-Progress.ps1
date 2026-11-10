<#
.SYNOPSIS
  Append the agent-events of one deliver call to <git-common-dir>/.agents/events/<run>.jsonl (or $AGENT_EVENTS_DIR/<run>.jsonl).
.DESCRIPTION
  Format: the agent-events core (GravionLabs/agent-events SPEC.md, schema/v0/core.schema.json; pinned tag in
  test/skills/delivery/agent-events/VERSION) plus the deliver profile deliver@1 (schema/deliver-profile.schema.json: profile
  types, fields under `deliver`, reason codes, tone rules). The CLI of the deliver calls stays; this script maps it:
    run.started           run.started: profiles ["deliver@1"], profileSchemas, agent {harness, model}, host {poimen.terminal,
                          herdr.pane, jsonl-file.pid}, subject = the milestone (-Milestone/-MilestoneTitle/-MilestoneUrl) or the
                          issue (-Issue), deliver {source, repository, milestone {key}}
    milestone.progress    progress without task: done = -Closed, total = -Total, label PBIs
    issue.started         task.started: task issue-<nr>, subject github.issue (owner/repo#nr, title, url)
    step.finished         step.finished: task of the issue (run-level without -Issue), step {name, n, total, text}, -Pr as link pull-request
    attention             attention: id, reason deliver.<kind>, text = -Reason, needsYou, deliver {kind, issue}; needs_you and
                          release_test carry no task (they outlive the PBI), the other kinds the task of the issue
    issue.finished        task.finished: outcome delivered -> succeeded, blocked/paused/skipped -> skipped, reason deliver.<outcome>
                          (-Code overrides it), text = -Reason, deliver {outcome}; merging -> deliver.merging (the task stays
                          open until the PR is merged); delivered and skipped resolve the open needs-you attentions of the issue
    release.updated       deliver.release.updated: deliver {round, pr, rcUrl, rcVersion, testIssue}
    iteration             deliver.iteration: deliver {n, max, issue} (loop iteration n of max, on the PBI -Issue)
    run.finished          run.finished: outcome (done, max reached -> succeeded; blocked, no progress -> failed; stopped -> cancelled),
                          reason deliver.<result>, text, deliver {result}
  The new core names are accepted as -Type too. A task event for an issue without an open task starts the task first
  (task.started), a later attempt of a finished issue gets the id issue-<nr>.<k>. The run id is AGENT_EVENTS_RUN. Without
  it, -Type run.started creates one (yyyyMMdd-HHmmss-<4 hex>) and prints `AGENT_EVENTS_RUN=<id>`; every other type
  without a run does nothing (exit 0). `seq` counts up per run without gaps (the file is locked while the lines are
  counted and appended); the lines of one call are written in one write call. `tone` and `needsYou` are decided here
  (Get-Tone, the tone rules of the profile). The host is read from the environment, never passed by the agent.
  Nested guard (#411, #463): the loop that owns a run exports AGENT_EVENTS_RUN and AGENT_EVENTS_OWNER=1 for its own calls and
  blanks AGENT_EVENTS_OWNER for every child it starts. An emitter with AGENT_EVENTS_RUN but without AGENT_EVENTS_OWNER=1 (a nested
  session) writes no run.started or run.finished, with or without an explicit -Run equal to the inherited run; all other events land.
  An interactive session has no AGENT_EVENTS_RUN: it opens the run with -Type run.started and passes the printed id as -Run.
  Retention: -Type run.started deletes finished and abandoned runs older than AGENT_EVENTS_KEEP_DAYS (default 7) and all
  beyond the newest AGENT_EVENTS_KEEP (default 100), in the events dir and in .agents/deliver-loop/<run>/ (ProgressRetention.ps1).
  Stop --now: after a step.finished, when .agents/deliver-loop/<run>/stop (DELIVER_LOOP_DIR, else the main worktree) contains `now`,
  `STOP requested` is printed on stdout (SKILL.md rule: start no further step).
  Never fails the caller: an I/O or usage error prints one line to stderr and the exit code is 0.
.PARAMETER Type
  run.started, milestone.progress, issue.started, step.finished, attention, issue.finished, release.updated, iteration or run.finished.
.PARAMETER Kind
  attention kind: pr_opened, review_fix, ci_red, paused, blocked, needs_you, release_test or stopping.
.PARAMETER Outcome
  issue.finished: delivered, merging (auto-merge on, the PR merges when the checks are green), blocked, paused or skipped.
.PARAMETER Reason
  The human sentence (`text`) of an attention, issue.finished or merging.
.PARAMETER Code
  Reason code of an attention or issue.finished instead of deliver.<kind or outcome>; prefixed deliver. when it is not.
.PARAMETER ReviewRound
  release.updated: the round of the release review (1, 2, ...).
.PARAMETER Iteration
  iteration: the number of the loop iteration; -IterationMax its maximum.
.PARAMETER RunResult
  run.finished result: done, max reached, blocked, no progress, stopped.
.PARAMETER Run
  Run id to write to; the fallback is AGENT_EVENTS_RUN. An interactive session passes the id printed by run.started with
  every later call (Bash calls share no shell state, and an env prefix would not match the permission allowlist). -Run
  alone does not make the emitter nested: without AGENT_EVENTS_RUN it writes run.started and run.finished.
#>
param(
  [Parameter(Mandatory)][string]$Type,
  [int]$Issue,
  [string]$Title,
  [string]$Url,
  [string]$Step,
  [int]$StepN,
  [int]$StepTotal,
  [string]$Result,
  [string]$Pr,
  [string]$Kind,
  [string]$Reason,
  [string]$Code,
  [string]$Outcome,
  [int]$Closed = -1,
  [int]$Total = -1,
  [string]$RunResult,
  [string]$Source,
  [string]$Harness,
  [string]$Model,
  [string]$Repository,
  [string]$Milestone,
  [string]$MilestoneTitle,
  [string]$MilestoneUrl,
  [string]$RcUrl,
  [string]$RcVersion,
  [int]$TestIssue,
  [string]$TestIssueUrl,
  [string]$PrUrl,
  [int]$ReviewRound,
  [int]$Iteration,
  [int]$IterationMax = -1,
  [string]$Run
)
$ErrorActionPreference = 'Stop'

$ProfileSchema = 'https://raw.githubusercontent.com/GravionLabs/skills/main/skills/delivery/deliver/schema/deliver-profile.schema.json'

# Tone: neutral, info, success, warning, danger. The only place of the tone rules (schema/deliver-profile.schema.json lists them;
# the loop colors by the tone of the event).
function Get-Tone([string]$type, [string]$step, [string]$result, [string]$kind, [string]$outcome, [string]$runResult) {
  switch ($type) {
    'attention' {
      switch ($kind) {
        'pr_opened' { return 'success' }
        { $_ -in 'review_fix', 'paused', 'needs_you', 'release_test' } { return 'warning' }
        { $_ -in 'ci_red', 'blocked' } { return 'danger' }
      }
      return 'neutral'
    }
    'task.finished' {
      switch ($outcome) { 'delivered' { return 'success' } 'blocked' { return 'danger' } 'paused' { return 'warning' } }
      return 'neutral'
    }
    'run.finished' {
      switch ($runResult) { 'done' { return 'success' } 'no progress' { return 'warning' } 'blocked' { return 'danger' } }
      return 'neutral'
    }
    'step.finished' {
      if ($step -eq 'done') { return 'success' }
      if ($result -match '\bblocked\b' -or $step -eq 'blocked') { return 'danger' }
      if ($result -match '\bpaused\b' -or $step -eq 'paused') { return 'warning' }
      switch -Regex ($step) {
        '^pr$' { return 'success' }
        '^merge(d)?$' { return 'success' }
        '^review$' { if ($result -match 'fix') { return 'warning' } }
        '^ci$' { if ($result -match 'red|fail') { return 'danger' } }
      }
      return 'neutral'
    }
  }
  return 'neutral'
}

. (Join-Path $PSScriptRoot 'ProgressRetention.ps1')

$stepNumbers = @{ select = 1; resume = 2; implement = 3; review = 4; fix = 5; pr = 6; ci = 7; merge = 7; merged = 7 }
$aliases = @{
  'milestone.progress' = 'progress'; 'issue.started' = 'task.started'; 'issue.finished' = 'task.finished'
  'release.updated' = 'deliver.release.updated'; 'iteration' = 'deliver.iteration'
}
$known = 'run.started', 'run.finished', 'progress', 'task.started', 'task.finished', 'step.finished', 'attention', 'deliver.release.updated', 'deliver.iteration'

function Add-If($h, [string]$k, $v) { if ($null -ne $v -and "$v" -ne '') { $h[$k] = $v } }
function Test-Url([string]$u) { $u -match '^https?://' }
function ConvertTo-Code([string]$c) {
  $c = ($c.ToLowerInvariant() -replace '[^a-z0-9.-]+', '-').Trim('-')
  if (-not $c) { return $null }
  if (-not $c.StartsWith('deliver.')) { $c = "deliver.$c" }
  return $c
}

# What the file already says, read under the lock: open task per issue, used task ids, open needs-you attentions, repository.
function Read-View([string]$text) {
  $view = @{ Open = @{}; Used = @{}; Attention = [System.Collections.Generic.List[hashtable]]::new(); Repository = $null }
  foreach ($line in ($text -split "`n")) {
    if ($line -notmatch '"type"\s*:\s*"(run\.started|task\.started|task\.finished|attention|attention\.resolved)"') { continue }
    try { $e = $line | ConvertFrom-Json -AsHashtable } catch { continue }
    if ($e -isnot [hashtable]) { continue }
    $task = [string]$e.task
    switch ([string]$e.type) {
      'run.started' { if ($e.deliver -is [hashtable] -and $e.deliver.repository) { $view.Repository = [string]$e.deliver.repository } }
      'task.started' {
        if ($task -match '^issue-(\d+)(\.\d+)?$' -and -not $view.Used.ContainsKey($task)) { $view.Used[$task] = $true; $view.Open[$Matches[1]] = $task }
      }
      'task.finished' {
        if ($task -match '^issue-(\d+)(\.\d+)?$' -and $view.Open[$Matches[1]] -eq $task) { $view.Open.Remove($Matches[1]) }
      }
      'attention' {
        if ($e.needsYou -eq $true -and -not $e.task -and $e.deliver -is [hashtable] -and $e.deliver.issue) {
          $view.Attention.Add(@{ Id = [string]$e.id; Issue = [int]$e.deliver.issue })
        }
      }
      'attention.resolved' {
        foreach ($a in @($view.Attention | Where-Object { $_.Id -eq [string]$e.id })) { [void]$view.Attention.Remove($a) }
      }
    }
  }
  return $view
}

# The events of this call (without seq), built from the parameters and the view.
function New-Events($view, [string]$type, [string]$runId) {
  $list = [System.Collections.Generic.List[System.Collections.Specialized.OrderedDictionary]]::new()
  $ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ')
  $repo = if ($Repository) { $Repository } else { $view.Repository }
  if (-not $repo -and $type -eq 'run.started') {
    $remote = @(& git -C (Get-Location).Path remote get-url origin 2>$null)[0]
    if ($LASTEXITCODE -eq 0 -and $remote -match '[:/]([^/:]+/[^/]+?)(\.git)?$') { $repo = $Matches[1] }
  }
  $new = { param([string]$t, [string]$tone) $script:evCount++; [ordered]@{ v = 1; seq = 0; ts = $ts; run = $runId; type = $t; tone = $tone } }
  $issueUrl = if (Test-Url $Url) { $Url } elseif ($repo -and $Issue) { "https://github.com/$repo/issues/$Issue" } else { $null }
  $subject = {
    $s = [ordered]@{ kind = 'github.issue'; id = $(if ($repo) { "$repo#$Issue" } else { "#$Issue" }); title = $(if ($Title) { $Title } else { "#$Issue" }) }
    Add-If $s url $issueUrl
    $s
  }
  # the open task of the issue, else a new one (task.started first)
  $taskOf = {
    if ($view.Open.ContainsKey("$Issue")) { return $view.Open["$Issue"] }
    $id = "issue-$Issue"; $k = 2
    while ($view.Used.ContainsKey($id)) { $id = "issue-$Issue.$k"; $k++ }
    $ev = & $new 'task.started' 'neutral'; $ev.task = $id; $ev.subject = & $subject
    $list.Add($ev); $view.Used[$id] = $true; $view.Open["$Issue"] = $id
    return $id
  }
  $prLinks = { $u = if ($Pr) { $Pr } else { $PrUrl }; if (Test-Url $u) { , @([ordered]@{ rel = 'pull-request'; url = $u }) } else { $null } }
  $resolveNeeds = {
    foreach ($a in @($view.Attention | Where-Object { $_.Issue -eq $Issue })) {
      $r = & $new 'attention.resolved' 'neutral'; $r.id = $a.Id; $list.Add($r); [void]$view.Attention.Remove($a)
    }
  }

  switch ($type) {
    'run.started' {
      $ev = & $new 'run.started' 'neutral'
      $ev.profiles = @('deliver@1')
      $ev.profileSchemas = [ordered]@{ 'deliver@1' = $ProfileSchema }
      $agent = [ordered]@{}; Add-If $agent harness $Harness; Add-If $agent model $Model
      if ($agent.Count) { $ev.agent = $agent }
      $h = [ordered]@{}
      Add-If $h 'poimen.terminal' $env:POIMEN_TERMINAL_ID; Add-If $h 'herdr.pane' $env:HERDR_PANE_ID
      # a session starts its run with a separate call: this process exits at once, so no pid (the one-hour rule covers it)
      if ($Source -ne 'session') { $h['jsonl-file.pid'] = "$PID" }
      $ev.host = $h
      if ($Milestone -or $MilestoneTitle) {
        $name = if ($MilestoneTitle) { $MilestoneTitle } else { $Milestone }
        $s = [ordered]@{ kind = 'github.milestone'; id = $name; title = $name }; Add-If $s url $(if (Test-Url $MilestoneUrl) { $MilestoneUrl })
        $ev.subject = $s
      } elseif ($Issue) { $ev.subject = & $subject }
      $d = [ordered]@{ source = $(if ($Source) { $Source } else { 'session' }) }
      Add-If $d repository $repo
      if ($Milestone) { $d.milestone = [ordered]@{ key = $Milestone } }
      $ev.deliver = $d
      $list.Add($ev)
    }
    'progress' {
      $ev = & $new 'progress' 'neutral'
      $t = [Math]::Max(0, $Total); $ev.done = [Math]::Min([Math]::Max(0, $Closed), $t); $ev.total = $t; $ev.label = 'PBIs'
      $list.Add($ev)
    }
    'task.started' {
      if (-not $Issue) { throw 'issue.started needs -Issue' }
      if (-not $view.Open.ContainsKey("$Issue")) { [void](& $taskOf) }
    }
    'step.finished' {
      if (-not $Step) { throw 'step.finished needs -Step' }
      $task = if ($Issue) { & $taskOf } else { $null }
      $ev = & $new 'step.finished' (Get-Tone 'step.finished' $Step $Result)
      if ($task) { $ev.task = $task }
      $s = [ordered]@{ name = $Step }
      $n = $StepN; $tot = $StepTotal
      if (-not $n -and $stepNumbers.ContainsKey($Step)) { $n = $stepNumbers[$Step]; if (-not $tot) { $tot = 7 } }
      if ($n) { $s.n = $n }
      if ($tot) { $s.total = $tot }
      Add-If $s text $Result
      $ev.step = $s
      $l = & $prLinks; if ($l) { $ev.links = $l }
      $list.Add($ev)
    }
    'attention' {
      if (-not $Kind) { throw 'attention needs -Kind' }
      $needs = $Kind -in 'needs_you', 'release_test'
      $task = if ($Issue -and -not $needs) { & $taskOf } else { $null }
      $ev = & $new 'attention' (Get-Tone 'attention' -kind $Kind)
      $ev.id = 'a' + ($script:baseSeq + $script:evCount)
      if ($task) { $ev.task = $task }
      $ev.reason = if ($Code) { ConvertTo-Code $Code } else { ConvertTo-Code $Kind }
      Add-If $ev text $Reason
      $ev.needsYou = $needs
      $l = & $prLinks; if ($l) { $ev.links = $l }
      $d = [ordered]@{ kind = $Kind }; if ($Issue) { $d.issue = $Issue }
      $ev.deliver = $d
      $list.Add($ev)
      if ($needs -and $Issue) { $view.Attention.Add(@{ Id = $ev.id; Issue = $Issue }) }
    }
    'task.finished' {
      if (-not $Issue) { throw 'issue.finished needs -Issue' }
      $o = if ($Outcome) { $Outcome } else { 'skipped' }
      if ($o -notin 'delivered', 'merging', 'blocked', 'paused', 'skipped') { throw "unknown outcome '$o'" }
      $task = & $taskOf
      if ($o -eq 'merging') {
        $ev = & $new 'deliver.merging' 'neutral'; $ev.task = $task
        Add-If $ev text $Reason
        $l = & $prLinks; if ($l) { $ev.links = $l }
        $ev.deliver = [ordered]@{ issue = $Issue }
        $list.Add($ev)
        & $resolveNeeds
        break
      }
      $ev = & $new 'task.finished' (Get-Tone 'task.finished' -outcome $o)
      $ev.task = $task
      $ev.outcome = if ($o -eq 'delivered') { 'succeeded' } else { 'skipped' }
      if ($Code) { $ev.reason = ConvertTo-Code $Code } elseif ($o -ne 'delivered') { $ev.reason = "deliver.$o" }
      Add-If $ev text $Reason
      $l = & $prLinks; if ($l) { $ev.links = $l }
      $ev.deliver = [ordered]@{ outcome = $o }
      $list.Add($ev)
      if ($o -in 'delivered', 'skipped') { & $resolveNeeds }
    }
    'deliver.release.updated' {
      $ev = & $new 'deliver.release.updated' 'neutral'
      $d = [ordered]@{}
      if ($ReviewRound) { $d.round = $ReviewRound }
      $u = if ($PrUrl) { $PrUrl } else { $Pr }; if (Test-Url $u) { $d.pr = $u }
      if (Test-Url $RcUrl) { $d.rcUrl = $RcUrl }
      Add-If $d rcVersion $RcVersion
      if ($TestIssue) { $t = [ordered]@{ number = $TestIssue }; if (Test-Url $TestIssueUrl) { $t.url = $TestIssueUrl }; $d.testIssue = $t }
      if (-not $d.Count) { throw 'release.updated needs -ReviewRound, -PrUrl, -RcUrl, -RcVersion or -TestIssue' }
      $ev.deliver = $d
      $list.Add($ev)
    }
    'deliver.iteration' {
      if ($Iteration -lt 1) { throw 'iteration needs -Iteration' }
      $ev = & $new 'deliver.iteration' 'neutral'
      $ev.deliver = [ordered]@{ n = $Iteration; max = [Math]::Max(0, $IterationMax) }
      if ($Issue) { $ev.deliver.issue = $Issue }
      $list.Add($ev)
    }
    'run.finished' {
      $res = if ($RunResult) { $RunResult } else { 'done' }
      $ev = & $new 'run.finished' (Get-Tone 'run.finished' -runResult $res)
      $ev.outcome = switch ($res) { { $_ -in 'done', 'max reached' } { 'succeeded' } 'stopped' { 'cancelled' } default { 'failed' } }
      if ($res -ne 'done') { $ev.reason = ConvertTo-Code $res }
      $ev.text = $res
      $ev.deliver = [ordered]@{ result = $res }
      $list.Add($ev)
    }
  }
  return , $list
}

try {
  $coreType = if ($aliases.ContainsKey($Type)) { $aliases[$Type] } else { $Type }
  if ($coreType -notin $known) { throw "unknown type '$Type'" }
  $run = if ($Run) { $Run } else { $env:AGENT_EVENTS_RUN }
  # a nested emitter (inherited AGENT_EVENTS_RUN without AGENT_EVENTS_OWNER=1, no -Run) neither starts nor finishes the owner's run (#411)
  # an explicit -Run equal to the inherited run is nested as well (#463)
  if ($env:AGENT_EVENTS_RUN -and $env:AGENT_EVENTS_OWNER -ne '1' -and $coreType -in 'run.started', 'run.finished' -and (-not $PSBoundParameters.ContainsKey('Run') -or $Run -eq $env:AGENT_EVENTS_RUN)) { exit 0 }
  $created = $false
  if (-not $run) {
    if ($coreType -ne 'run.started') { exit 0 }
    $run = '{0}-{1}' -f (Get-Date).ToString('yyyyMMdd-HHmmss'), ('{0:x4}' -f (Get-Random -Maximum 65536))
    $created = $true
  }
  if ($run -notmatch '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$') { throw "invalid run id '$run'" }

  $dir = $env:AGENT_EVENTS_DIR
  if (-not $dir) {
    $common = @(& git -C (Get-Location).Path rev-parse --git-common-dir 2>$null)[0]
    if ($LASTEXITCODE -ne 0 -or -not $common) { throw 'not in a git repository and AGENT_EVENTS_DIR is not set' }
    $dir = Join-Path ([System.IO.Path]::GetFullPath($common, (Get-Location).Path)) '.agents/events'
  }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $file = Join-Path $dir "$run.jsonl"

  # lock the file while the lines are counted and the new ones are appended (seq without gaps), one write call
  $fs = $null
  for ($try = 0; $try -lt 50 -and -not $fs; $try++) {
    try { $fs = [System.IO.FileStream]::new($file, [System.IO.FileMode]::OpenOrCreate, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None) }
    catch [System.IO.IOException] { Start-Sleep -Milliseconds 20 }
  }
  if (-not $fs) { throw "cannot lock $file" }
  try {
    $bytes = [byte[]]::new($fs.Length)
    [void]$fs.Read($bytes, 0, $bytes.Length)
    $n = 0; foreach ($b in $bytes) { if ($b -eq 10) { $n++ } }
    $script:baseSeq = $n; $script:evCount = 0
    $events = New-Events (Read-View ([System.Text.Encoding]::UTF8.GetString($bytes))) $coreType $run
    $text = [System.Text.StringBuilder]::new()
    foreach ($ev in $events) { $n++; $ev.seq = $n; [void]$text.Append(($ev | ConvertTo-Json -Compress -Depth 8) + "`n") }
    if ($text.Length) {
      $line = [System.Text.Encoding]::UTF8.GetBytes($text.ToString())
      $fs.Seek(0, [System.IO.SeekOrigin]::End) | Out-Null
      $fs.Write($line, 0, $line.Length)
      $fs.Flush()
    }
  } finally { $fs.Dispose() }
  if ($coreType -eq 'run.started') {
    # retention: old event files and stream recordings (next to the events dir and under the current directory)
    $loopDirs = @((Join-Path (Split-Path $dir -Parent) 'deliver-loop'), (Join-Path (Get-Location).Path '.agents/deliver-loop'))
    Invoke-ProgressRetention -EventsDir $dir -LoopDirs $loopDirs -CurrentRun $run
  }
  if ($created) { Write-Output "AGENT_EVENTS_RUN=$run" }
  # stop --now (#476): the stop file of the loop run contains `now` -> the session starts no further step
  if ($coreType -eq 'step.finished' -and $env:AGENT_EVENTS_RUN) {
    try {
      $loopDirs = @()
      if ($env:DELIVER_LOOP_DIR) { $loopDirs += $env:DELIVER_LOOP_DIR }
      else {
        $main = @(& git -C (Get-Location).Path worktree list --porcelain 2>$null | Where-Object { $_ -like 'worktree *' })[0]
        if ($main) { $loopDirs += Join-Path $main.Substring(9) '.agents/deliver-loop' }
        $loopDirs += Join-Path (Get-Location).Path '.agents/deliver-loop'
      }
      foreach ($d in $loopDirs) {
        $sf = Join-Path $d "$($env:AGENT_EVENTS_RUN)/stop"
        if ((Test-Path -LiteralPath $sf -PathType Leaf) -and (Get-Content -LiteralPath $sf -Raw) -match '^\s*now\s*$') { Write-Output 'STOP requested'; break }
      }
    } catch { Write-Verbose "stop check: $_" }
  }
} catch {
  [Console]::Error.WriteLine("Report-Progress: $($_.Exception.Message)")
}
exit 0
