<#
.SYNOPSIS
  Requests a stop of the running deliver loop of the repository (writes or removes its stop file).
.DESCRIPTION
  Run from the repository root. Without -Run the run is read from .agents/deliver-loop/latest.txt and
  taken when its progress.jsonl has no `result` record. Writes <run>/stop (empty, `now` with -Now);
  -Cancel deletes it. No running loop: exit 1, one line on stderr, nothing written.
#>
[CmdletBinding()]
param(
  [switch]$Now,
  [switch]$Cancel,
  [string]$Run
)
$ErrorActionPreference = 'Stop'

$base = Join-Path (Get-Location).Path '.agents/deliver-loop'
$runDir = $null
if ($Run) {
  $runDir = Join-Path $base $Run
} else {
  $latest = Join-Path $base 'latest.txt'
  if (Test-Path -LiteralPath $latest -PathType Leaf) {
    $p = (Get-Content -LiteralPath $latest -Raw).Trim()
    if ($p) { $runDir = if ([IO.Path]::IsPathRooted($p)) { $p } else { Join-Path (Get-Location).Path $p } }
  }
}
$running = $false
if ($runDir -and (Test-Path -LiteralPath $runDir -PathType Container)) {
  $running = $true
  $progress = Join-Path $runDir 'progress.jsonl'
  if (Test-Path -LiteralPath $progress -PathType Leaf) {
    foreach ($line in Get-Content -LiteralPath $progress) {
      if ($line -match '"event"\s*:\s*"result"') { $running = $false; break }
    }
  }
}
if (-not $running) {
  [Console]::Error.WriteLine('deliver-loop stop: no running loop in this repository.')
  exit 1
}

$id = Split-Path $runDir -Leaf
$stop = Join-Path $runDir 'stop'
if ($Cancel) {
  Remove-Item -LiteralPath $stop -Force -ErrorAction SilentlyContinue
  Write-Output 'stop cancelled'
  exit 0
}
[IO.File]::WriteAllText($stop, $(if ($Now) { 'now' } else { '' }))
Write-Output "stop requested for run ${id}: after the current $(if ($Now) { 'step' } else { 'PBI' })"
exit 0
