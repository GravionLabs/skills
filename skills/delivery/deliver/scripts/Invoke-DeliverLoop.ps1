<#
.SYNOPSIS
  Runs `/deliver` in a fresh harness process per PBI until the targets are done, blocked, stalled or -Max is reached.
.DESCRIPTION
  A long unattended run in one session grows its context and dies with it. This loop starts
  `claude -p "/deliver <targets> --unattended --max 1"` once per PBI; deliver keeps all state in GitHub, so there is no
  queue file. Progress is read from GitHub before and after each iteration: the open PBIs of the targets without the
  labels needs-decision / needs-refinement / interactive (deliver skips interactive PBIs unattended). No change stops
  the loop ("no progress"); nothing open means done; open PBIs that all wait on an open blocker or a label mean blocked.
  Observability: every stream record goes to .agents/deliver-loop/<run>/<nr>.jsonl (<nr> is the first PBI that was ready
  at the start of the iteration), a summary line per step to .agents/deliver-loop.log and stdout, desktop notifications
  for the attention steps (macOS osascript, Windows toast), the herdr pane display when HERDR_ENV=1.
  Run it from the repository root. Exit code: 0 done or max reached, 1 no progress, 2 blocked, 64 bad arguments.
.PARAMETER Target
  Issue numbers (PBI, Feature or Epic), as for `/deliver`: `-Target 12,14` or `-Target 12 14` (a comma list also works
  under `pwsh -File`, which does not split it itself).
.PARAMETER Milestone
  Adds the open PBIs of this milestone (as `/deliver --milestone`).
.PARAMETER Max
  Stop after this many iterations (PBIs delivered, blocked or paused in total).
.PARAMETER Model
  Model of the orchestrating session.
.PARAMETER Harness
  Only claude (Claude Code) for now.
#>
[CmdletBinding()]
param(
  [string[]]$Target = @(),
  [string]$Milestone = '',
  [ValidateRange(1, 10000)][int]$Max = 0,
  [string]$Model = 'sonnet',
  [ValidateSet('claude')][string]$Harness = 'claude',
  [Parameter(ValueFromRemainingArguments)][string[]]$MoreTargets = @()
)
$ErrorActionPreference = 'Stop'

$Nrs = @(($Target + $MoreTargets) | ForEach-Object { $_ -split '[,\s]+' } | Where-Object { $_ })
if (($Nrs | Where-Object { $_ -notmatch '^\d+$' }) -or ($Nrs.Count -eq 0 -and -not $Milestone)) {
  [Console]::Error.WriteLine('Give -Target <nr...> (issue numbers) and/or -Milestone <name>.')
  exit 64
}
$Nrs = @($Nrs | ForEach-Object { [int]$_ })

$Held = @('needs-decision', 'needs-refinement', 'interactive')
$LogFile = Join-Path (Get-Location) '.agents/deliver-loop.log'
$RunDir = Join-Path (Get-Location) ".agents/deliver-loop/$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
$Recent = [System.Collections.Generic.List[string]]::new()
$AgentNames = @{}
$Pane = if ($env:HERDR_ENV -eq '1') { $env:HERDR_PANE_ID } else { '' }

function Write-Step([string]$text) {
  $line = '{0} {1}' -f (Get-Date).ToString('HH:mm:ss'), $text
  New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
  [IO.File]::AppendAllText($LogFile, $line + "`n")
  [Console]::Out.WriteLine($line)
  $Recent.Add($line)
  if ($Recent.Count -gt 10) { $Recent.RemoveAt(0) }
}

function Send-Notice([string]$text) {
  try {
    if ($IsMacOS) {
      $esc = $text.Replace('\', '\\').Replace('"', '\"')
      & osascript -e "display notification `"$esc`" with title `"deliver loop`"" 2>$null | Out-Null
    } elseif ($IsWindows) {
      [void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
      $xml = [Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent('ToastText02')
      $nodes = $xml.GetElementsByTagName('text')
      [void]$nodes.Item(0).AppendChild($xml.CreateTextNode('deliver loop'))
      [void]$nodes.Item(1).AppendChild($xml.CreateTextNode($text))
      [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('PowerShell').Show([Windows.UI.Notifications.ToastNotification]::new($xml))
    }
  } catch { Write-Verbose "notification failed: $_" }
}

function Set-Pane([string]$text, [switch]$Clear) {
  if (-not $Pane) { return }
  try {
    if ($Clear) { & herdr pane report-metadata $Pane --source deliver --clear-display-agent 2>$null | Out-Null }
    else { & herdr pane report-metadata $Pane --source deliver --display-agent $text 2>$null | Out-Null }
  } catch { Write-Verbose "herdr failed: $_" }
}

function Get-Json([string[]]$ghArgs) {
  $out = & gh @ghArgs 2>$null
  if ($LASTEXITCODE -ne 0) { throw "gh $($ghArgs -join ' ') failed" }
  if (-not $out) { return $null }
  return ($out -join "`n") | ConvertFrom-Json
}

function Add-Pbis([int]$nr, [hashtable]$seen, $found) {
  if ($seen.ContainsKey($nr)) { return }
  $seen[$nr] = $true
  $issue = Get-Json @('issue', 'view', "$nr", '--json', 'number,state,labels')
  $labels = @($issue.labels | ForEach-Object { $_.name })
  if ($labels -contains 'pbi') {
    if ($issue.state -eq 'OPEN') { $found.Add([pscustomobject]@{ Number = $nr; Labels = $labels }) }
    return
  }
  foreach ($child in @(Get-Json @('api', "repos/{owner}/{repo}/issues/$nr/sub_issues?per_page=100"))) {
    if ($child) { Add-Pbis ([int]$child.number) $seen $found }
  }
}

# State from GitHub: open PBIs of the targets; eligible = no hold label; ready = eligible and no open blocker.
function Get-State {
  $seen = @{}
  $found = [System.Collections.Generic.List[object]]::new()
  foreach ($nr in $Nrs) { Add-Pbis $nr $seen $found }
  if ($Milestone) {
    $items = @(Get-Json @('issue', 'list', '--milestone', $Milestone, '--state', 'open', '--limit', '200', '--json', 'number'))
    foreach ($item in $items) { if ($item) { Add-Pbis ([int]$item.number) $seen $found } }
  }
  $eligible = @($found | Where-Object { -not ($_.Labels | Where-Object { $Held -contains $_ }) })
  $ready = @($eligible | Where-Object {
      $blockers = @(Get-Json @('api', "repos/{owner}/{repo}/issues/$($_.Number)/dependencies/blocked_by?per_page=100"))
      -not ($blockers | Where-Object { $_ -and $_.state -eq 'open' })
    })
  [pscustomobject]@{
    Open     = $found.Count
    Eligible = @($eligible | ForEach-Object { $_.Number } | Sort-Object)
    Ready    = @($ready | ForEach-Object { $_.Number } | Sort-Object)
  }
}

function Get-StopReason($state) {
  if ($state.Open -eq 0) { return 'done' }
  if ($state.Ready.Count -eq 0) { return 'blocked' }
  return $null
}

function Get-Short([string]$s, [int]$n = 120) {
  $first = (($s -split "`r?`n") | Where-Object { $_.Trim() } | Select-Object -First 1)
  if (-not $first) { return '' }
  if ($first.Length -gt $n) { return $first.Substring(0, $n) + '…' }
  return $first
}

function Get-Attention([string]$step, [string]$result) {
  switch -Regex ($step) {
    '^pr$' { return 'PR opened' }
    '^review$' { if ($result -match 'fix') { return 'review fix round' } }
    '^ci$' { if ($result -match 'red|fail') { return 'CI red' } }
    '^merge(d)?$' { return 'merged' }
  }
  if ($result -match '\bpaused\b' -or $step -eq 'paused') { return 'paused' }
  if ($result -match '\bblocked\b' -or $step -eq 'blocked') { return 'blocked' }
  return $null
}

# One stream-json record: summary line, progress lines of deliver (top level only), tool errors.
function Read-Record([string]$line, [int]$position, [int]$total) {
  try { $rec = $line | ConvertFrom-Json } catch { Write-Step "? $(Get-Short $line)"; return }
  $parent = $rec.parent_tool_use_id
  $prefix = if ($parent -and $AgentNames.ContainsKey($parent)) { "[$($AgentNames[$parent])] " } elseif ($parent) { '[subagent] ' } else { '' }
  foreach ($c in @($rec.message.content)) {
    if (-not $c) { continue }
    if ($rec.type -eq 'assistant' -and $c.type -eq 'tool_use') {
      $in = $c.input
      $what = ''
      foreach ($k in 'description', 'file_path', 'command', 'pattern', 'path') {
        if ($in.$k) { $what = Get-Short ([string]$in.$k); break }
      }
      if ($c.name -in 'Agent', 'Task') { $AgentNames[$c.id] = Get-Short ([string]$in.description) 60 }
      Write-Step "$prefix$($c.name) $what"
    } elseif ($rec.type -eq 'assistant' -and $c.type -eq 'text') {
      Write-Step "$prefix» $(Get-Short $c.text)"
      if ($prefix) { continue }
      foreach ($l in ($c.text -split "`r?`n")) {
        if ($l -match '^#(\d+) ([\w-]+): (.*)$') {
          Set-Pane "deliver $position/$total #$($Matches[1]) $($Matches[2]): $($Matches[3])"
          $why = Get-Attention $Matches[2] $Matches[3]
          if ($why) { Send-Notice "#$($Matches[1]) $why" }
        }
      }
    } elseif ($rec.type -eq 'user' -and $c.type -eq 'tool_result' -and $c.is_error) {
      $body = if ($c.content -is [string]) { $c.content } else { ($c.content | ForEach-Object { $_.text }) -join "`n" }
      Write-Step "$prefix✗ $(Get-Short $body)"
    }
  }
}

function Invoke-Iteration([int]$n, [int]$total, $state) {
  New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
  $jsonl = Join-Path $RunDir "$($state.Ready[0]).jsonl"
  $targets = @($Nrs | ForEach-Object { "$_" })
  if ($Milestone) { $targets += @('--milestone', $Milestone) }
  $prompt = "/deliver $($targets -join ' ') --unattended --max 1"
  Write-Step "iteration $n/$total start: $prompt"
  Set-Pane "deliver $n/$total starting"
  $saved = $env:HERDR_ENV
  $env:HERDR_ENV = ''
  try {
    & claude -p $prompt --model $Model --permission-mode auto --output-format stream-json --verbose 2>&1 | ForEach-Object {
      $line = "$_"
      if ($_ -is [System.Management.Automation.ErrorRecord]) { Write-Step "stderr $(Get-Short $line)"; return }
      [IO.File]::AppendAllText($jsonl, $line + "`n")
      Read-Record $line $n $total
    }
    if ($LASTEXITCODE -ne 0) { Write-Step "claude exited with $LASTEXITCODE" }
  } finally { $env:HERDR_ENV = $saved }
}

$result = 'done'
$code = 0
$i = 0
try {
  $state = Get-State
  $result = Get-StopReason $state
  $total = if ($Max -gt 0) { [Math]::Min($Max, $state.Eligible.Count) } else { $state.Eligible.Count }
  while (-not $result) {
    $i++
    Invoke-Iteration $i $total $state
    $after = Get-State
    if (($after.Eligible -join ',') -eq ($state.Eligible -join ',')) {
      $result = 'no progress'
      Write-Step 'no progress: the open PBIs did not change. Last log lines:'
      foreach ($l in $Recent.ToArray()) { [Console]::Out.WriteLine("  $l") }
      break
    }
    $state = $after
    $result = Get-StopReason $state
    if (-not $result -and $Max -gt 0 -and $i -ge $Max) { $result = 'max reached' }
  }
  $code = switch ($result) { 'no progress' { 1 } 'blocked' { 2 } default { 0 } }
  Write-Step "loop result: $result ($i iteration(s), $($state.Open) PBI(s) open)"
  Send-Notice "loop result: $result"
} finally {
  Set-Pane '' -Clear
}
exit $code
