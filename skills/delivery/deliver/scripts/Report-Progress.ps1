<#
.SYNOPSIS
  Append one progress event of a run to <git-common-dir>/.agents/events/<run>.jsonl (or $AGENT_EVENTS_DIR/<run>.jsonl).
.DESCRIPTION
  Schema: schema/progress-event.schema.json. The run id is AGENT_EVENTS_RUN. Without it, -Type run.started creates one
  (yyyyMMdd-HHmmss-<4 hex>) and prints `AGENT_EVENTS_RUN=<id>`; every other type without a run does nothing (exit 0).
  `seq` counts up per run without gaps (the file is locked while the line is counted and appended). The line is written
  whole in one write call. `tone` is decided here from type, step, result and kind (Get-Tone, table in the schema).
  The host (POIMEN_TERMINAL_ID, HERDR_PANE_ID) is read from the environment, never passed by the agent.
  Terminal sink: after the append the event is shown in the terminal (tokens and agent state through TerminalBackend.ps1,
  mapping table in references/terminal-backends.md). Only the outermost emitter reports: the process that writes run.started
  prints `AGENT_EVENTS_TERMINAL=owner` next to the run id and keeps it in its own environment; an emitter with a run but without
  `owner` (a nested one) skips the sink, so the owner strips or overrides the variable for the processes it starts. Without a run
  (a run.started creates it) the process is the owner. Backend none or a failing call: no-op, the event is written anyway.
  Never fails the caller: an I/O error prints one line to stderr and the exit code is 0.
.PARAMETER Type
  run.started, milestone.progress, issue.started, step.finished, attention, issue.finished, release.updated or run.finished.
.PARAMETER Kind
  attention kind: pr_opened, review_fix, ci_red, paused, blocked, needs_you or release_test.
.PARAMETER Outcome
  issue.finished: delivered, blocked, paused or skipped.
.PARAMETER ReviewRound
  release.updated: the round of the release review (1, 2, ...).
.PARAMETER RunResult
  run.finished result: done, max reached, blocked, no progress, ...
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
  [int]$ReviewRound
)
$ErrorActionPreference = 'Stop'

# Tone: neutral, info, success, warning, danger. Same rules as Get-Attention / Get-StepColor of Invoke-DeliverLoop.ps1.
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
    'issue.finished' {
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

. (Join-Path $PSScriptRoot 'TerminalBackend.ps1')

# Terminal sink: tokens and agent state of one event. Table in references/terminal-backends.md.
function Send-TerminalSink($ev, [string]$prUrl) {
  $backend = Get-TerminalBackend
  if ($backend -eq 'none') { return }
  $pane = Get-LoopPane $backend
  $state = { param($s) if (-not $script:SinkConflict) { Set-LoopAgentState -Pane $pane -State $s -Backend $backend } }
  $script:SinkConflict = Test-LoopAgentConflict -Pane $pane -Backend $backend
  switch ($ev.type) {
    'step.finished' {
      $t = [ordered]@{}
      if ($ev.issue) { $t['deliver'] = "#$($ev.issue.number)" }
      if ($ev.step) {
        $text = "$($ev.step.name)"
        if ($ev.step.n -and $ev.step.total) { $text = "$($ev.step.n)/$($ev.step.total) $text" }
        if ($ev.step.text) { $text += ": $($ev.step.text)" }
        if ($text.Length -gt 80) { $text = $text.Substring(0, 80) }
        $t['deliver_step'] = $text
      }
      if ($prUrl -match '(\d+)/?$') { $t['deliver_pr'] = "#$($Matches[1])" }
      $t['deliver_tone'] = $ev.tone
      Set-LoopTokens -Pane $pane -Token $t -Backend $backend
    }
    'milestone.progress' {
      if ($null -ne $ev.closed -and $null -ne $ev.total) { Set-LoopTokens -Pane $pane -Token ([ordered]@{ deliver_progress = "$($ev.closed)/$($ev.total)" }) -Backend $backend }
    }
    'issue.started' { & $state 'working' }
    'attention' { if ($ev.kind -in 'paused', 'blocked') { & $state 'blocked' } }
    'run.finished' {
      Clear-LoopTokens -Pane $pane -Name 'deliver', 'deliver_step', 'deliver_pr', 'deliver_progress', 'deliver_tone' -Backend $backend
      & $state $(if ($ev.result -in 'blocked', 'no progress') { 'blocked' } else { 'idle' })
      if (-not $script:SinkConflict) { Clear-LoopAgentState -Pane $pane -Backend $backend }
    }
  }
}

$stepNumbers = @{ select = 1; resume = 2; implement = 3; review = 4; fix = 5; pr = 6; ci = 7; merge = 7; merged = 7 }

function Add-If($h, [string]$k, $v) { if ($null -ne $v -and "$v" -ne '') { $h[$k] = $v } }

try {
  $run = $env:AGENT_EVENTS_RUN
  $created = $false
  if (-not $run) {
    if ($Type -ne 'run.started') { exit 0 }
    $run = '{0}-{1}' -f (Get-Date).ToString('yyyyMMdd-HHmmss'), ('{0:x4}' -f (Get-Random -Maximum 65536))
    $created = $true
  }
  if ($run -notmatch '^[\w.-]+$') { throw "invalid run id '$run'" }

  $dir = $env:AGENT_EVENTS_DIR
  if (-not $dir) {
    $common = @(& git -C (Get-Location).Path rev-parse --git-common-dir 2>$null)[0]
    if ($LASTEXITCODE -ne 0 -or -not $common) { throw 'not in a git repository and AGENT_EVENTS_DIR is not set' }
    $dir = Join-Path ([System.IO.Path]::GetFullPath($common, (Get-Location).Path)) '.agents/events'
  }
  New-Item -ItemType Directory -Force -Path $dir | Out-Null
  $file = Join-Path $dir "$run.jsonl"

  $tone = Get-Tone $Type $Step $Result $Kind $Outcome $RunResult
  $ev = [ordered]@{ v = 1; seq = 0; ts = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.fffZ'); run = $run; type = $Type; tone = $tone }

  if ($Type -eq 'run.started') {
    Add-If $ev source $Source
    Add-If $ev harness $Harness
    Add-If $ev model $Model
    if (-not $Repository) {
      $remote = @(& git -C (Get-Location).Path remote get-url origin 2>$null)[0]
      if ($LASTEXITCODE -eq 0 -and $remote -match '[:/]([^/:]+/[^/]+?)(\.git)?$') { $Repository = $Matches[1] }
    }
    Add-If $ev repository $Repository
    if ($Milestone -or $MilestoneTitle -or $MilestoneUrl) {
      $m = [ordered]@{}; Add-If $m key $Milestone; Add-If $m title $MilestoneTitle; Add-If $m url $MilestoneUrl; $ev.milestone = $m
    }
    $ev.pid = $PID
    $h = [ordered]@{}; Add-If $h poimenTerminal $env:POIMEN_TERMINAL_ID; Add-If $h herdrPane $env:HERDR_PANE_ID
    if ($h.Count) { $ev.host = $h }
  }
  if ($Issue) {
    $i = [ordered]@{ number = $Issue }; Add-If $i title $Title; Add-If $i url $Url; $ev.issue = $i
  }
  if ($Step) {
    $s = [ordered]@{ name = $Step }
    if (-not $StepN -and $stepNumbers.ContainsKey($Step)) { $StepN = $stepNumbers[$Step]; if (-not $StepTotal) { $StepTotal = 7 } }
    if ($StepN) { $s.n = $StepN }
    if ($StepTotal) { $s.total = $StepTotal }
    Add-If $s text $Result
    $ev.step = $s
  }
  Add-If $ev prUrl $Pr
  if ($Type -eq 'attention') {
    Add-If $ev kind $Kind; Add-If $ev reason $Reason
    if ($Kind -in 'needs_you', 'release_test') { $ev.needsYou = $true }
  }
  Add-If $ev outcome $Outcome
  if ($Closed -ge 0) { $ev.closed = $Closed }
  if ($Total -ge 0) { $ev.total = $Total }
  Add-If $ev result $RunResult
  if ($Type -eq 'release.updated') {
    Add-If $ev rcUrl $RcUrl; Add-If $ev rcVersion $RcVersion
    if ($TestIssue) { $t = [ordered]@{ number = $TestIssue }; Add-If $t url $TestIssueUrl; $ev.testIssue = $t }
    Add-If $ev prUrl $PrUrl
    if ($ReviewRound) { $ev.reviewRound = $ReviewRound }
  }

  # lock the file while the lines are counted and the new one is appended (seq without gaps), one write call
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
    $ev.seq = $n + 1
    $line = [System.Text.Encoding]::UTF8.GetBytes((($ev | ConvertTo-Json -Compress -Depth 6) + "`n"))
    $fs.Seek(0, [System.IO.SeekOrigin]::End) | Out-Null
    $fs.Write($line, 0, $line.Length)
    $fs.Flush()
  } finally { $fs.Dispose() }
  if ($created) { Write-Output "AGENT_EVENTS_RUN=$run"; Write-Output 'AGENT_EVENTS_TERMINAL=owner' }
  if ($created -or $env:AGENT_EVENTS_TERMINAL -eq 'owner') {
    try { Send-TerminalSink ([pscustomobject]($ev | ConvertTo-Json -Depth 6 | ConvertFrom-Json)) $Pr } catch { Write-Verbose "terminal sink: $_" }
  }
} catch {
  [Console]::Error.WriteLine("Report-Progress: $($_.Exception.Message)")
}
exit 0
