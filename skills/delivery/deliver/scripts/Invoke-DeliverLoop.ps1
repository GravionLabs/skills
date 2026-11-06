<#
.SYNOPSIS
  Runs `/deliver` in a fresh harness process per PBI until the targets are done, blocked, stalled or -Max is reached.
.DESCRIPTION
  A long unattended run in one session grows its context and dies with it. This loop starts
  `claude -p "/deliver <targets> --unattended --max 1"` (`-Harness claude`, the default) or `copilot -p` (`-Harness copilot`) once per PBI; deliver keeps all state in GitHub, so there is no
  queue file. Progress is read from GitHub before and after each iteration: the open PBIs of the targets without the
  labels needs-decision / needs-refinement / interactive (deliver skips interactive PBIs unattended). No change stops
  the loop ("no progress"); nothing open means done (unless a closed PBI of the milestone carries needs-decision, the paused release review: blocked); open PBIs that all wait on an open blocker or a label mean blocked.
  Observability: every stream record goes to .agents/deliver-loop/<run>/<nr>.jsonl (<nr> is the first PBI that was ready
  at the start of the iteration), a summary line per step to .agents/deliver-loop.log (plain) and stdout, the same line
  with ANSI colors to .agents/deliver-loop.ansi.log (long text is cut to the terminal width, 120 characters when redirected), desktop notifications for the attention steps (macOS osascript,
  Windows toast), the pane tokens deliver, deliver_step, deliver_pr, deliver_progress (herdr HERDR_ENV=1, poimen POIMEN_SOCKET + POIMEN_TERMINAL_ID), a progress line per step and status.json (-Milestone; references/loop.md) and, with -LogPane in herdr on a terminal,
  a split pane labeled deliver-log below the session that tails the log (TerminalBackend.ps1; never closed by the loop).
  Stdout carries the colors of the .ansi.log when it is a terminal and neither -NoColor nor NO_COLOR is set; otherwise it is plain.
  Machine-readable progress for a control session (`deliver` `references/control.md`): .agents/deliver-loop/<run>/progress.jsonl,
  one JSON object per line (`start`, `iteration-start`, `iteration-end`, `result`), and .agents/deliver-loop/latest.txt with the path of the newest run directory.
  Run it from the repository root. Exit code: 0 done or max reached, 1 no progress, 2 blocked, 64 bad arguments.
.PARAMETER Target
  Issue numbers (PBI, Feature or Epic), as for `/deliver`: `-Target 12,14` or `-Target 12 14` (a comma list also works
  under `pwsh -File`, which does not split it itself).
.PARAMETER Milestone
  Adds the open PBIs and bugs of this milestone (as `/deliver --milestone`): M<n> or a sub-number M<n>.<m> (also after close renamed it M<n> (x.y.z)) or a legacy title.
.PARAMETER Max
  Stop after this many iterations (PBIs delivered, blocked or paused in total).
.PARAMETER Model
  Model per PBI for every iteration. Without it, claude takes the model of the PBI's tier (fast haiku, standard sonnet,
  strong opus; the `Tier:` line of the body, else the size S/M/L, else standard; `references/roles.md`), and copilot uses auto.
.PARAMETER Harness
  claude (Claude Code, default) or copilot (GitHub Copilot CLI: `copilot -p … --model <model> --allow-all-tools
  --allow-all-paths --allow-all-urls --no-ask-user --output-format json`). Any other value fails before the first iteration.
.PARAMETER LogPane
  Opens the herdr log pane `deliver-log` (herdr, stdout a terminal). Off by default: toggle it with Switch-LogPane.ps1.
.PARAMETER NoPane
  Deprecated no-op (the pane is off by default); use -LogPane to open it.
.PARAMETER NoColor
  Writes no .ansi.log and colors no stdout (as does a non-empty NO_COLOR); the pane tails the plain log.
#>
[CmdletBinding()]
param(
  [string[]]$Target = @(),
  [string]$Milestone = '',
  [ValidateRange(1, 10000)][int]$Max = 0,
  [string]$Model = '',
  [string]$Harness = 'claude',
  [switch]$LogPane,
  [switch]$NoPane,
  [switch]$NoColor,
  [Parameter(ValueFromRemainingArguments)][string[]]$MoreTargets = @()
)
$ErrorActionPreference = 'Stop'

$Harnesses = @('claude', 'copilot')
if ($Harness -notin $Harnesses) {
  [Console]::Error.WriteLine("Unknown -Harness '$Harness'. Supported: $($Harnesses -join ', ').")
  exit 64
}

if ($NoPane) { [Console]::Error.WriteLine('deliver-loop: -NoPane is deprecated and does nothing (the log pane is off by default; -LogPane opens it).') }

if ($Harness -eq 'copilot' -and -not $Model) { $Model = 'auto' }

# Model per tier (references/roles.md): the tier decides the model of an iteration when -Model is not given.
$TierModels = @{ fast = 'haiku'; standard = 'sonnet'; strong = 'opus' }
function Get-PbiTier([int]$nr) {
  $issue = Get-Json @('api', "repos/{owner}/{repo}/issues/$nr")
  $body = [string]$issue.body
  $tier = $null; $from = 'default'
  if ($body -match '(?m)^\s*(?:[-*]\s*)?\**Tier:?\**:?\s*(fast|standard|strong)\b') { $tier = $Matches[1]; $from = 'Tier line' }
  elseif ($body -match '(?m)^\s*(?:[-*]\s*)?\**Size:?\**:?\s*([SML])\b') {
    $tier = @{ S = 'fast'; M = 'standard'; L = 'strong' }[$Matches[1]]; $from = "size $($Matches[1])"
  }
  if (-not $tier) { $tier = 'standard' }
  [pscustomobject]@{ Tier = $tier; Model = $TierModels[$tier]; From = $from }
}

$Nrs = @(($Target + $MoreTargets) | ForEach-Object { $_ -split '[,\s]+' } | Where-Object { $_ })
if (($Nrs | Where-Object { $_ -notmatch '^\d+$' }) -or ($Nrs.Count -eq 0 -and -not $Milestone)) {
  [Console]::Error.WriteLine('Give -Target <nr...> (issue numbers) and/or -Milestone <name>.')
  exit 64
}
$Nrs = @($Nrs | ForEach-Object { [int]$_ })

$Held = @('needs-decision', 'needs-refinement', 'interactive')
$LogFile = Join-Path (Get-Location) '.agents/deliver-loop.log'
$AnsiFile = if ($NoColor -or $env:NO_COLOR) { '' } else { Join-Path (Get-Location) '.agents/deliver-loop.ansi.log' }
$Esc = [char]27
$Ansi = @{ dim = "$Esc[2m"; cyan = "$Esc[36m"; red = "$Esc[31m"; yellow = "$Esc[33m"; green = "$Esc[32m"; reset = "$Esc[0m" }
# stdout gets the colors of the .ansi.log when it is a terminal (Test-LoopTerminal in TerminalBackend.ps1 defines "terminal").
. (Join-Path $PSScriptRoot 'TerminalBackend.ps1')
$ColorStdout = [bool]$AnsiFile -and (Test-LoopTerminal)
$RunDir = Join-Path (Get-Location) ".agents/deliver-loop/$((Get-Date).ToString('yyyyMMdd-HHmmss'))"
$Progress = Join-Path $RunDir 'progress.jsonl'
$Recent = [System.Collections.Generic.List[string]]::new()
$AgentNames = @{}
# resolved once: the harness runs with HERDR_ENV blanked, the progress callbacks still report
$Backend = Get-TerminalBackend
$Pane = Get-LoopPane $Backend

# One step: plain to the log; colored to the .ansi.log and a terminal stdout (time dim, $Tool cyan, the rest in $Color).
# $Tool is looked up from $ToolAt on (after the subagent prefix).
function Write-Step([string]$text, [string]$Color = '', [string]$Tool = '', [int]$ToolAt = 0) {
  $time = (Get-Date).ToString('HH:mm:ss')
  $line = "$time $text"
  New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
  [IO.File]::AppendAllText($LogFile, $line + "`n")
  $colored = $line
  if ($AnsiFile) {
    $body = if ($Color) { "$($Ansi[$Color])$text$($Ansi.reset)" } else { $text }
    $at = if ($Tool) { $text.IndexOf($Tool, $ToolAt) } else { -1 }
    if ($at -ge 0 -and -not $Color) { $body = $text.Substring(0, $at) + "$($Ansi.cyan)$Tool$($Ansi.reset)" + $text.Substring($at + $Tool.Length) }
    $colored = "$($Ansi.dim)$time$($Ansi.reset) $body"
    [IO.File]::AppendAllText($AnsiFile, $colored + "`n")
  }
  Write-Host $(if ($ColorStdout) { $colored } else { $line })
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

$PanePbi = ''
$PanePr = ''
$PaneStep = ''
$PaneProgress = ''
function Set-Pane([string]$Nr = '', [string]$Step = '', [switch]$Clear) {
  # pane tokens (#16): deliver=#<nr>, deliver_step=<pos>/<total> <step>[: <result>], deliver_pr=#<pr>, deliver_progress=<closed>/<total> (#329); values <= 80 chars
  if ($Clear) { Clear-LoopTokens -Pane $Pane -Name 'deliver', 'deliver_step', 'deliver_pr', 'deliver_progress' -Backend $Backend; return }
  if ($Nr -ne $script:PanePbi) { $script:PanePbi = $Nr; $script:PanePr = '' }
  if ($Step -match '^\d+/\d+ pr: .*?#(\d+)') { $script:PanePr = $Matches[1] }
  $script:PaneStep = $Step
  $value = if ($Step.Length -gt 80) { $Step.Substring(0, 79) + '…' } else { $Step }
  $tokens = [ordered]@{ deliver = "#$Nr"; deliver_step = $value }
  if ($script:PanePr) { $tokens['deliver_pr'] = "#$($script:PanePr)" }
  if ($script:PaneProgress) { $tokens['deliver_progress'] = $script:PaneProgress }
  Set-LoopTokens -Pane $Pane -Token $tokens -TtlMs 3600000 -Backend $Backend
}

# Agent state (#191): the loop reports its own lifecycle (source deliver-loop, agent deliver); the terminal tracks only the pane's agent, not the claude -p children.
# working per iteration, blocked on a pause/blocked step or when the loop ends blocked / no progress, idle at the end, then release. Any backend failure is ignored.
# report-agent replaces the state of another agent in the pane and release does not restore it, so the loop reports only
# in a pane without another agent (Test-LoopAgentConflict, checked once; backend failure: reports as before).
$Paused = $false
$AgentStateOff = $false
function Set-AgentState([string]$State = '', [switch]$Release) {
  if ($AgentStateOff) { return }
  if ($Release) { Clear-LoopAgentState -Pane $Pane -Backend $Backend } else { Set-LoopAgentState -Pane $Pane -State $State -Backend $Backend }
}

# Get-Milestones.ps1 of github-milestone: sibling skill (installed) or skills/github (repository)
$MilestoneScript = @('../../github-milestone', '../../../github/github-milestone' | ForEach-Object { Join-Path $PSScriptRoot "$_/scripts/Get-Milestones.ps1" }) |
  Where-Object { Test-Path $_ } | Select-Object -First 1

# Status (#329): the live state of the run for other tools (.agents/deliver-loop/status.json, schema/deliver-loop-status.schema.json)
# and the progress line after each step. Counts come from Get-DeliverStatus.ps1 (read at the start and after each iteration, the
# same set as the stop rules); between reads the step comes from the progress lines. Needs -Milestone; a failing read keeps the last status.
$StatusFile = Join-Path (Get-Location) '.agents/deliver-loop/status.json'
$StatusScript = Join-Path $PSScriptRoot 'Get-DeliverStatus.ps1'
$StartedAt = (Get-Date).ToUniversalTime().ToString('o')
$StepNumber = @{ select = 1; resume = 2; implement = 3; review = 4; fix = 5; pr = 6; ci = 7; merge = 7; merged = 7; cleanup = 7 }
$Live = @{ Block = $null; Current = $null; Delivered = @(); Paused = @(); Pr = @{}; Model = $Model; Result = 'running' }

function Get-RefNumber([string]$text) { if ($text -match '/(?:issues|pull)/(\d+)') { [int]$Matches[1] } else { 0 } }

function Read-StatusBlock {
  if (-not $Milestone -or -not $MilestoneScript) { return }
  try {
    $raw = & $StatusScript -Milestone $Milestone -Delivered ([int[]]@($Live.Delivered)) -MilestonesScript $MilestoneScript 2>$null
    # no $LASTEXITCODE test: the script ends after a native call (the release PR lookup) that may fail on its own
    if ($raw) { $Live.Block = ($raw | Out-String) | ConvertFrom-Json }
  } catch { Write-Verbose "status block not read: $_" }
}

function Get-LoopProgressToken { if ($Live.Block) { "$($Live.Block.closed)/$($Live.Block.total)" } else { '' } }

# M5 ▓▓▓▓░░░░ 7/19 · #322 review · 1 blocked · 1 needs you
function Get-ProgressLine {
  $b = $Live.Block
  if (-not $b) { return '' }
  $filled = if ($b.total -gt 0) { [Math]::Min(8, [int][Math]::Round(8 * $b.closed / $b.total)) } else { 0 }
  $parts = @("$($b.key) $('▓' * $filled)$('░' * (8 - $filled)) $($b.closed)/$($b.total)")
  $c = $Live.Current
  if ($c) { $parts += "#$($c.number) $(($c.step.text -split ':')[0])".TrimEnd() }
  if (@($b.waiting).Count) { $parts += "$(@($b.waiting).Count) blocked" }
  $needs = @($b.needsYou).Count + @($Live.Paused).Count
  if ($needs) { $parts += "$needs needs you" }
  return $parts -join ' · '
}

function ConvertTo-StatusItem($ref, [string]$reason) {
  [ordered]@{ number = [int]$ref.number; url = [string]$ref.url; reason = $(if ($reason) { $reason } else { 'waiting' }) }
}

function Write-LoopStatus {
  $b = $Live.Block
  if (-not $b -or -not $b.baseUrl) { return }
  try {
    $base = [string]$b.baseUrl
    $current = $null
    if ($Live.Current -and $Live.Result -eq 'running') { $current = $Live.Current }
    $needs = @(@($b.needsYou) | ForEach-Object {
        $n = Get-RefNumber $_
        if ($n) { [ordered]@{ number = $n; url = [regex]::Match($_, 'https://\S+/(?:issues|pull)/\d+').Value; reason = ($_ -replace 'https://\S+', '').Trim(' :,') } }
      })
    $needs += @($Live.Paused)
    $delivered = @(@($b.delivered) | ForEach-Object {
        $pr = $Live.Pr["$($_.number)"]
        [ordered]@{ pbi = [int]$_.number; url = [string]$_.url; prUrl = $(if ($pr) { "$base/pull/$pr" } else { [string]$_.url }) }
      })
    $doc = [ordered]@{
      schemaVersion = 1
      run = (Split-Path $RunDir -Leaf)
      harness = $Harness
      model = $(if ($Live.Model) { $Live.Model } else { 'default' })
      repository = (($base -split '/')[-2..-1] -join '/')
      milestone = [ordered]@{ key = [string]$b.key; title = [string]$b.milestone; url = [string]$b.milestoneUrl }
      closed = [int]$b.closed
      total = [int]$b.total
      current = $current
      delivered = $delivered
      blocked = @(@($b.waiting) | ForEach-Object { ConvertTo-StatusItem $_ ([string]$_.reason) })
      paused = @($Live.Paused)
      needsYou = @($needs | ForEach-Object { [ordered]@{ number = $_.number; url = $(if ($_.url) { $_.url } else { "$base/issues/$($_.number)" }); reason = $(if ($_.reason) { $_.reason } else { 'needs you' }) } })
      release = [ordered]@{ reviewRound = $b.release.round; prUrl = $b.release.pr }
      startedAt = $StartedAt
      updatedAt = (Get-Date).ToUniversalTime().ToString('o')
      result = $Live.Result
    }
    New-Item -ItemType Directory -Force -Path (Split-Path $StatusFile) | Out-Null
    $tmp = "$StatusFile.tmp"
    [IO.File]::WriteAllText($tmp, ($doc | ConvertTo-Json -Depth 8))
    Move-Item -LiteralPath $tmp -Destination $StatusFile -Force
  } catch { Write-Verbose "status.json not written: $_" }
}

# Refresh after a change: status.json, the backend progress token, one progress line.
function Publish-LoopStatus([switch]$Line) {
  Write-LoopStatus
  $script:PaneProgress = Get-LoopProgressToken
  if ($Line) {
    $text = Get-ProgressLine
    if ($text) { Write-Step $text 'cyan' }
  }
}

function Set-LiveCurrent([int]$nr) {
  $b = $Live.Block
  $base = if ($b) { [string]$b.baseUrl } else { '' }
  $title = "#$nr"; $url = "$base/issues/$nr"
  if ($b -and $b.ready.next -and [int]$b.ready.next.number -eq $nr) { $title = [string]$b.ready.next.title; $url = [string]$b.ready.next.url }
  $Live.Current = [ordered]@{ number = $nr; title = $title; url = $url; step = [ordered]@{ n = 1; total = 7; text = 'select' }; prUrl = $null }
}

function Update-LiveStep([int]$nr, [string]$step, [string]$result) {
  if (-not $Live.Current -or $Live.Current.number -ne $nr) { Set-LiveCurrent $nr }
  $c = $Live.Current
  if ($StepNumber.ContainsKey($step)) { $c.step.n = $StepNumber[$step] }
  $c.step.text = $(if ($result) { "${step}: $result" } else { $step })
  if ($step -eq 'pr' -and $result -match '#(\d+)') {
    $Live.Pr["$nr"] = $Matches[1]
    if ($Live.Block -and $Live.Block.baseUrl) { $c.prUrl = "$($Live.Block.baseUrl)/pull/$($Matches[1])" }
  }
  $why = Get-Attention $step $result
  if ($why -in 'paused', 'blocked') {
    $base = if ($Live.Block) { [string]$Live.Block.baseUrl } else { '' }
    $Live.Paused = @(@($Live.Paused | Where-Object { $_.number -ne $nr }) + [ordered]@{ number = $nr; url = "$base/issues/$nr"; reason = $(if ($result) { $result } else { $why }) })
  }
}

function Get-Json([string[]]$ghArgs, [switch]$Pwsh) {
  $out = if ($Pwsh) { & pwsh -NoProfile @ghArgs 2>$null } else { & gh @ghArgs 2>$null }
  if ($LASTEXITCODE -ne 0) { throw "$(if ($Pwsh) { 'pwsh' } else { 'gh' }) $($ghArgs -join ' ') failed" }
  if (-not $out) { return $null }
  return ($out -join "`n") | ConvertFrom-Json
}

# $ms: title of the --milestone when the walk started at a Feature or Epic of it; a PBI or Bug below it with no or another milestone
# is added to $skipped, not to $found (the same rule as deliver step 1: "select: outside M<n>, skipped").
function Add-Pbis([int]$nr, [hashtable]$seen, $found, [string]$ms = '', $skipped = $null) {
  if ($seen.ContainsKey($nr)) { return }
  $seen[$nr] = $true
  # REST per issue: `gh issue view` runs on the GraphQL budget (#117)
  $issue = Get-Json @('api', "repos/{owner}/{repo}/issues/$nr")
  $labels = @($issue.labels | ForEach-Object { $_.name })
  if ($labels -contains 'pbi' -or $labels -contains 'bug') {
    if ($issue.state -eq 'open') {
      if ($ms -and $issue.milestone.title -ne $ms) { $skipped.Add([pscustomobject]@{ Number = $nr; Milestone = $(if ($issue.milestone) { $issue.milestone.title } else { 'none' }) }) }
      else { $found.Add([pscustomobject]@{ Number = $nr; Labels = $labels }) }
    }
    return
  }
  foreach ($child in @(Get-Json @('api', "repos/{owner}/{repo}/issues/$nr/sub_issues?per_page=100"))) {
    if ($child) { Add-Pbis ([int]$child.number) $seen $found $ms $skipped }
  }
}

# State from GitHub: open PBIs of the targets; eligible = no hold label; ready = eligible and no open blocker.
function Get-State {
  $seen = @{}
  $found = [System.Collections.Generic.List[object]]::new()
  $skipped = [System.Collections.Generic.List[object]]::new()
  foreach ($nr in $Nrs) { Add-Pbis $nr $seen $found }
  if ($Milestone) {
    # one REST call lists the milestone (Get-Milestones.ps1 -Mode issues); PBIs and Bugs need no read of their own (#127)
    $list = Get-Json @('-File', $MilestoneScript, '-Mode', 'issues', '-Name', $Milestone, '-State', 'open') -Pwsh
    foreach ($item in @($list.issues)) {
      if (-not $item) { continue }
      if ($item.labels -contains 'pbi' -or $item.labels -contains 'bug') {
        if (-not $seen.ContainsKey([int]$item.number)) { $seen[[int]$item.number] = $true; $found.Add([pscustomobject]@{ Number = [int]$item.number; Labels = @($item.labels) }) }
      } else { Add-Pbis ([int]$item.number) $seen $found ([string]$list.milestone.title) $skipped }
    }
  }
  # release-review pause (references/release-review.md): nothing open, but a closed PBI or Bug of the milestone carries needs-decision
  $paused = $false
  if ($Milestone -and $found.Count -eq 0) {
    $closed = Get-Json @('-File', $MilestoneScript, '-Mode', 'issues', '-Name', $Milestone, '-State', 'closed') -Pwsh
    $paused = [bool]@(@($closed.issues) | Where-Object { $_ -and $_.labels -contains 'needs-decision' -and ($_.labels -contains 'pbi' -or $_.labels -contains 'bug') })
  }
  $eligible = @($found | Where-Object { -not ($_.Labels | Where-Object { $Held -contains $_ }) })
  $ready = @($eligible | Where-Object {
      $blockers = @(Get-Json @('api', "repos/{owner}/{repo}/issues/$($_.Number)/dependencies/blocked_by?per_page=100"))
      -not ($blockers | Where-Object { $_ -and $_.state -eq 'open' })
    })
  [pscustomobject]@{
    Open     = $found.Count
    Skipped  = @($skipped)
    Paused   = $paused
    Eligible = @($eligible | ForEach-Object { $_.Number } | Sort-Object)
    Ready    = @($ready | ForEach-Object { $_.Number } | Sort-Object)
  }
}

function Get-StopReason($state) {
  if ($state.Open -eq 0) { return $(if ($state.Paused) { 'blocked' } else { 'done' }) }
  if ($state.Ready.Count -eq 0) { return 'blocked' }
  return $null
}

# Room for a cut text: the terminal width minus time, agent prefix and tool name (40); 120 when stdout is redirected.
function Get-LineWidth {
  if ([Console]::IsOutputRedirected) { return 120 }
  $w = try { [Console]::WindowWidth } catch { 0 }
  return [Math]::Max(120, $w - 40)
}

function Get-Short([string]$s, [int]$n = 0) {
  if ($n -le 0) { $n = Get-LineWidth }
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

# Color of a progress line in the pane: PR opened, merged, done green; the other attention steps yellow.
function Get-StepColor([string]$step, [string]$result) {
  if ($step -eq 'done') { return 'green' }
  $why = Get-Attention $step $result
  if ($why -in 'PR opened', 'merged') { return 'green' }
  if ($why) { return 'yellow' }
  return ''
}

# Steps shared by both harnesses: a tool call, assistant text (with progress lines of deliver), a tool error.
function Write-ToolStep([string]$prefix, [string]$name, $in) {
  $what = ''
  foreach ($k in 'description', 'file_path', 'command', 'pattern', 'path') {
    if ($in.$k) { $what = Get-Short ([string]$in.$k); break }
  }
  Write-Step "$prefix$name $what" -Tool $name -ToolAt $prefix.Length
}

function Write-TextStep([string]$prefix, [string]$text, [int]$position, [int]$total) {
  $color = ''
  if (-not $prefix) {
    foreach ($l in ($text -split "`r?`n")) { if ($l -match '^#\d+ ([\w-]+): (.*)$') { $color = Get-StepColor $Matches[1] $Matches[2]; if ($color) { break } } }
  }
  Write-Step "$prefix» $(Get-Short $text)" $color
  if ($prefix) { return }
  foreach ($l in ($text -split "`r?`n")) {
    if ($l -match '^#(\d+) ([\w-]+): (.*)$') {
      Update-LiveStep ([int]$Matches[1]) $Matches[2] $Matches[3]
      $script:PaneProgress = Get-LoopProgressToken
      Set-Pane $Matches[1] "$position/$total $($Matches[2]): $($Matches[3])"
      Publish-LoopStatus -Line
      $why = Get-Attention $Matches[2] $Matches[3]
      if ($why -in 'paused', 'blocked') { $script:Paused = $true; Set-AgentState 'blocked' }
      if ($why) { Send-Notice "#$($Matches[1]) $why" }
    }
  }
}

# One stream-json record of Claude Code: summary line, progress lines of deliver (top level only), tool errors.
function Read-Record([string]$line, [int]$position, [int]$total) {
  try { $rec = $line | ConvertFrom-Json } catch { Write-Step "? $(Get-Short $line)"; return }
  $parent = $rec.parent_tool_use_id
  $prefix = if ($parent -and $AgentNames.ContainsKey($parent)) { "[$($AgentNames[$parent])] " } elseif ($parent) { '[subagent] ' } else { '' }
  foreach ($c in @($rec.message.content)) {
    if (-not $c) { continue }
    if ($rec.type -eq 'assistant' -and $c.type -eq 'tool_use') {
      if ($c.name -in 'Agent', 'Task') { $AgentNames[$c.id] = Get-Short ([string]$c.input.description) 60 }
      Write-ToolStep $prefix $c.name $c.input
    } elseif ($rec.type -eq 'assistant' -and $c.type -eq 'text') {
      Write-TextStep $prefix $c.text $position $total
    } elseif ($rec.type -eq 'user' -and $c.type -eq 'tool_result' -and $c.is_error) {
      $body = if ($c.content -is [string]) { $c.content } else { ($c.content | ForEach-Object { $_.text }) -join "`n" }
      Write-Step "$prefix✗ $(Get-Short $body)" 'red'
    }
  }
}

# One JSONL event of Copilot CLI (--output-format json): {type, data}. Tool calls come as tool.execution_start,
# failures as tool.execution_complete with success=false, text as assistant.message. Subagent steps get the
# agentDisplayName of subagent.started as prefix (events with a parentToolCallId; [subagent] if unknown). Unknown event types are ignored (only logged to the jsonl).
function Read-CopilotRecord([string]$line, [int]$position, [int]$total) {
  try { $rec = $line | ConvertFrom-Json } catch { Write-Step "? $(Get-Short $line)"; return }
  $d = $rec.data
  $prefix = if ($d.parentToolCallId -and $AgentNames.ContainsKey($d.parentToolCallId)) { "[$($AgentNames[$d.parentToolCallId])] " } elseif ($d.parentToolCallId) { '[subagent] ' } else { '' }
  switch ($rec.type) {
    'subagent.started' { if ($d.toolCallId) { $script:AgentNames[$d.toolCallId] = Get-Short ([string]($d.agentDisplayName ?? $d.agentName)) 60 } }
    'tool.execution_start' {
      Write-ToolStep $prefix $d.toolName $d.arguments
    }
    'assistant.message' { if ($d.content) { Write-TextStep $prefix ([string]$d.content) $position $total } }
    'tool.execution_complete' {
      if ($d.success -eq $false) {
        $body = if ($d.error.message) { [string]$d.error.message } elseif ($d.result.content) { [string]$d.result.content } else { 'tool failed' }
        Write-Step "$prefix✗ $(Get-Short $body)" 'red'
      }
    }
  }
}

# One machine-readable record for the control session (progress.jsonl); never throws into the loop.
function Write-ProgressRecord([string]$Name, [hashtable]$Data = @{}) {
  try {
    New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
    $rec = [ordered]@{ event = $Name; time = (Get-Date).ToUniversalTime().ToString('o') }
    foreach ($k in $Data.Keys) { $rec[$k] = $Data[$k] }
    [IO.File]::AppendAllText($Progress, ($rec | ConvertTo-Json -Compress -Depth 4) + "`n")
    $latest = Join-Path (Split-Path $RunDir -Parent) 'latest.txt'
    [IO.File]::WriteAllText($latest, $RunDir)
  } catch { Write-Verbose "progress event not written: $_" }
}

function Invoke-Iteration([int]$n, [int]$total, $state) {
  New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
  $jsonl = Join-Path $RunDir "$($state.Ready[0]).jsonl"
  $targets = @($Nrs | ForEach-Object { "$_" })
  if ($Milestone) { $targets += @('--milestone', $Milestone) }
  $prompt = "/deliver $($targets -join ' ') --unattended --max 1"
  $iterModel = $Model
  if ($Harness -eq 'claude' -and -not $Model) {
    $t = Get-PbiTier ([int]$state.Ready[0])
    $iterModel = $t.Model
    Write-Step "#$($state.Ready[0]) tier $($t.Tier) ($($t.From)) → model $iterModel"
  }
  Write-Step "iteration $n/$total start: $prompt"
  Write-ProgressRecord 'iteration-start' @{ n = $n; total = $total; pbi = [int]$state.Ready[0]; open = $state.Open; model = $iterModel }
  $script:Paused = $false
  $Live.Model = $iterModel
  Set-LiveCurrent ([int]$state.Ready[0])
  Publish-LoopStatus
  Set-AgentState 'working'
  Set-Pane "$($state.Ready[0])" "$n/$total starting"
  $saved = $env:HERDR_ENV
  $env:HERDR_ENV = ''
  try {
    $cli = if ($Harness -eq 'copilot') {
      @('-p', $prompt, '--model', $iterModel, '--allow-all-tools', '--allow-all-paths', '--allow-all-urls', '--no-ask-user', '--output-format', 'json')
    } else {
      @('-p', $prompt, '--model', $iterModel, '--permission-mode', 'auto', '--output-format', 'stream-json', '--verbose')
    }
    & $Harness @cli 2>&1 | ForEach-Object {
      $line = "$_"
      if ($_ -is [System.Management.Automation.ErrorRecord]) { Write-Step "stderr $(Get-Short $line)" 'red'; return }
      [IO.File]::AppendAllText($jsonl, $line + "`n")
      if ($Harness -eq 'copilot') { Read-CopilotRecord $line $n $total } else { Read-Record $line $n $total }
    }
    if ($LASTEXITCODE -ne 0) { Write-Step "$Harness exited with $LASTEXITCODE" 'red' }
  } finally { $env:HERDR_ENV = $saved }
}

$result = 'done'
$code = 0
$i = 0
try {
  if ($LogPane) { Open-LogPane -LogFile $(if ($AnsiFile) { $AnsiFile } else { $LogFile }) -Backend $Backend }
  if (Test-LoopAgentConflict -Pane $Pane -Backend $Backend) {
    $script:AgentStateOff = $true
    Write-Step 'agent state not reported: another agent runs in this pane (start the loop in its own pane)' 'yellow'
  }
  $state = Get-State
  Read-StatusBlock
  Publish-LoopStatus -Line
  Write-ProgressRecord 'start' @{ targets = @($Nrs); milestone = $Milestone; max = $Max; harness = $Harness; model = $Model; open = $state.Open }
  foreach ($sk in $state.Skipped) { Write-Step "#$($sk.Number) select: outside $Milestone (milestone: $($sk.Milestone)), skipped; set the milestone to deliver it" 'yellow' }
  $result = Get-StopReason $state
  $total = if ($Max -gt 0) { [Math]::Min($Max, $state.Eligible.Count) } else { $state.Eligible.Count }
  while (-not $result) {
    $i++
    Invoke-Iteration $i $total $state
    $after = Get-State
    $gone = @($state.Eligible | Where-Object { $after.Eligible -notcontains $_ })
    $Live.Delivered = @($Live.Delivered) + $gone
    $Live.Paused = @($Live.Paused | Where-Object { $gone -notcontains $_.number })
    $Live.Current = $null
    Read-StatusBlock
    Publish-LoopStatus -Line
    Write-ProgressRecord 'iteration-end' @{ n = $i; pbi = [int]$state.Ready[0]; delivered = (@($state.Eligible | Where-Object { $after.Eligible -notcontains $_ }) -join ','); open = $after.Open }
    if (($after.Eligible -join ',') -eq ($state.Eligible -join ',')) {
      $result = 'no progress'
      Write-Step 'no progress: the open PBIs did not change. Last log lines:' 'yellow'
      foreach ($l in $Recent.ToArray()) { Write-Host "  $l" }
      break
    }
    $state = $after
    $result = Get-StopReason $state
    if (-not $result -and $Max -gt 0 -and $i -ge $Max) { $result = 'max reached' }
  }
  $code = switch ($result) { 'no progress' { 1 } 'blocked' { 2 } default { 0 } }
  $color = if ($result -in 'done', 'max reached') { 'green' } else { 'yellow' }
  Write-Step "loop result: $result ($i iteration(s), $($state.Open) PBI(s) open)" $color
  $Live.Result = $result
  $Live.Current = $null
  Publish-LoopStatus
  Write-ProgressRecord 'result' @{ result = $result; code = $code; iterations = $i; open = $state.Open }
  Send-Notice "loop result: $result"
  Set-AgentState $(if (($result -in 'blocked','no progress') -or $Paused) { 'blocked' } else { 'idle' })
} finally {
  Set-Pane -Clear
  Set-AgentState -Release
}
exit $code
