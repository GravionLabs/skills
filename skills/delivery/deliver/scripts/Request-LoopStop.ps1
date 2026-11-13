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

# An objective runner of this host runs this checkout (running.json of ObjectiveRunner.ps1, pid alive): a stop file
# would end only the repository loop and the next round would start again. Refuse and point to `release`.
if (-not $Cancel) {
  $h = if ($env:HOME) { $env:HOME } else { $env:USERPROFILE }
  $here = (Get-Location).ProviderPath.TrimEnd('/', '\')
  $objBase = Join-Path $h '.cache/deliver/objectives'
  if (Test-Path -LiteralPath $objBase -PathType Container) {
    foreach ($f in Get-ChildItem -LiteralPath $objBase -Filter running.json -Recurse -File -Depth 4) {
      $r = try { Get-Content -LiteralPath $f.FullName -Raw | ConvertFrom-Json } catch { $null }
      if (-not $r -or -not $r.pid -or -not (Get-Process -Id ([int]$r.pid) -ErrorAction SilentlyContinue)) { continue }
      $cos = @($r.checkouts) + @($r.checkout) | Where-Object { $_ }
      # real path of each checkout (symlinked temp or home directories), as Get-Location reports it
      $saved = [Environment]::CurrentDirectory
      $real = foreach ($c in $cos) {
        if (Test-Path -LiteralPath ([string]$c) -PathType Container) {
          [Environment]::CurrentDirectory = [string]$c   # reading it back gives the resolved path
          [Environment]::CurrentDirectory.TrimEnd('/', '\')
        }
      }
      [Environment]::CurrentDirectory = $saved
      if ($real | Where-Object { $_ -eq $here }) {
        [Console]::Error.WriteLine('deliver-loop stop: an objective run is active here; stop would end only this repository loop and the next round would start again. Use `deliver-loop release <ref>` on the runner''s host.')
        exit 1
      }
    }
  }
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
