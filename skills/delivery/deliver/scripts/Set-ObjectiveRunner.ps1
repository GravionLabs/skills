<#
.SYNOPSIS
  `deliver-loop takeover <objective> [-Force]` and `deliver-loop release <objective>`: hands the runner of an [Objective] over.
.DESCRIPTION
  takeover: sets the runner marker (ObjectiveRunner.ps1) to this host. A missing, own or dead marker (heartbeat older than
  30 minutes) is taken without asking; a foreign live one only with -Force (else exit 1, nothing written). The old runner
  sees the foreign marker at its next heartbeat or round boundary, stops after its running PBI and ends `handed over`.
  release: with a live objective loop on this host it writes the release request and asks the running repository loop to
  stop after its PBI; the loop then ends the round, pushes the branches, posts a status comment, deletes the marker and
  ends `released`. Without a live loop it does that itself (own marker only; a foreign one: exit 1).
  Exit code: 0 done, 1 refused or failed, 64 bad arguments.
.PARAMETER Action
  takeover or release.
.PARAMETER Objective
  <owner>/<repo>#<nr> of the [Objective].
.PARAMETER Force
  takeover: also take a live foreign marker.
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)][string]$Action = '',
  [Parameter(Position = 1)][string]$Objective = '',
  [switch]$Force
)
$ErrorActionPreference = 'Stop'

if ($Action -notin 'takeover', 'release' -or $Objective -notmatch '^([^/\s#]+/[^/\s#]+)#([0-9]+)$') {
  [Console]::Error.WriteLine('Usage: deliver-loop takeover <owner>/<repo>#<nr> [-Force] | deliver-loop release <owner>/<repo>#<nr>')
  exit 64
}
$repo = $Matches[1]; $nr = [int]$Matches[2]
function Write-Step([string]$text, [string]$Color = '') { [void]$Color; Write-Output $text }
function Send-Notice([string]$text) { [void]$text }
. (Join-Path $PSScriptRoot 'ObjectiveLoop.ps1')
$hostId = Get-RunnerHostId

if ($Action -eq 'takeover') {
  $st = Get-RunnerComment $repo $nr
  if (-not $st.Ok) { [Console]::Error.WriteLine("runner marker of $Objective not read."); exit 1 }
  $m = $st.Marker
  if ($m -and $m.Host -ne $hostId -and (Test-RunnerLive $m) -and -not $Force) {
    Write-Output "runner: $Objective runs on $($m.Host) (heartbeat $($m.Heartbeat), $([int]$m.Age) min ago); -Force takes it over."
    exit 1
  }
  $r = Enter-ObjectiveRunner $repo $nr $hostId -Force
  if ($r.Action -eq 'error') { [Console]::Error.WriteLine("runner marker of $Objective not written."); exit 1 }
  $from = if ($m -and $m.Host -ne $hostId) { " from $($m.Host)" } else { '' }
  Write-Output "runner: $hostId took over $Objective$from; continue with deliver-loop -Objective $Objective"
  exit 0
}

$local = Get-LocalRunner $repo $nr
if ($local) {
  $dir = Get-RunnerStateDir $repo $nr
  [IO.File]::WriteAllText((Join-Path $dir 'release'), (Get-RunnerNow))
  $running = if ($local.checkouts) { @($local.checkouts) } else { @($local.checkout) }
  $stopped = $false
  foreach ($co in $running) { if (Request-RepoLoopStop ([string]$co)) { $stopped = $true } }
  $after = if ($stopped) { 'after the running PBI' } else { 'at the next round boundary' }
  Write-Output "release requested: the runner of $Objective (pid $($local.pid)) releases $after"
  exit 0
}
$st = Get-RunnerState $repo $nr $hostId
if ($st.State -ne 'own') {
  $why = switch ($st.State) { 'foreign' { "runs on $($st.Holder.Host)" } 'missing' { 'has no runner marker' } default { 'runner marker not read' } }
  [Console]::Error.WriteLine("release: $Objective $why; nothing released.")
  exit 1
}
$top = @(& git rev-parse --show-toplevel 2>$null)[0]
$here = if ($LASTEXITCODE -eq 0 -and $top) { [IO.Path]::GetFullPath($top) } else { (Get-Location).Path }
$status = Read-ObjectiveStatus (Join-Path $PSScriptRoot 'Get-ObjectiveStatus.ps1') $Objective
$checkouts = @($here) + @($status.repos | ForEach-Object { Resolve-Checkout ([string]$_.repository) $repo $here } | Where-Object { $_.Exists } | ForEach-Object { $_.Path })
Invoke-RunnerRelease $repo $nr $Objective $hostId $st.Id $checkouts (Join-Path $PSScriptRoot 'Get-ObjectiveStatus.ps1') | ForEach-Object { "runner: $_" }
exit 0
