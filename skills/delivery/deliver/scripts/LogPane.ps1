<#
.SYNOPSIS
  Shared by Invoke-DeliverLoop.ps1 (and the pane toggle): opens a herdr split pane below the session that tails a log file.
.DESCRIPTION
  Dot-source it, then call `Open-LogPane -LogFile <path>`. It does nothing outside herdr (HERDR_ENV is not 1), when stdout
  is not a terminal (cron, CI, redirected) or when the tab already has a pane labeled deliver-log. Any herdr failure is
  ignored: the caller runs on without a pane. The pane is never closed here, so the log stays readable after the run.
  DELIVER_LOOP_ASSUME_TTY=1 treats a redirected stdout as a terminal (tests only).
#>

$script:LogPaneLabel = 'deliver-log'

function Test-LogPaneHost {
  if ($env:HERDR_ENV -ne '1') { return $false }
  return (-not [Console]::IsOutputRedirected) -or $env:DELIVER_LOOP_ASSUME_TTY -eq '1'
}

# Panes of the current tab (the tab of HERDR_PANE_ID; every pane when that pane is unknown).
function Get-LogPaneTabPane {
  $out = & herdr pane list 2>$null
  if ($LASTEXITCODE -ne 0 -or -not $out) { throw 'herdr pane list failed' }
  $panes = @((($out -join "`n") | ConvertFrom-Json).result.panes)
  $own = $panes | Where-Object { $_.pane_id -eq $env:HERDR_PANE_ID } | Select-Object -First 1
  if ($own -and $own.PSObject.Properties['tab_id']) { return @($panes | Where-Object { $_.tab_id -eq $own.tab_id }) }
  return $panes
}

function Open-LogPane {
  [CmdletBinding()]
  param([Parameter(Mandatory)][string]$LogFile)
  if (-not (Test-LogPaneHost)) { return }
  try {
    $existing = Get-LogPaneTabPane | Where-Object { $_.PSObject.Properties['label'] -and $_.label -eq $script:LogPaneLabel }
    if ($existing) { return }
    New-Item -ItemType Directory -Force -Path (Split-Path $LogFile) | Out-Null
    if (-not (Test-Path -LiteralPath $LogFile)) { New-Item -ItemType File -Path $LogFile | Out-Null }
    $out = & herdr pane split --current --direction down --ratio 0.7 --no-focus 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $out) { throw 'herdr pane split failed' }
    $id = (($out -join "`n") | ConvertFrom-Json).result.pane.pane_id
    if (-not $id) { throw 'herdr pane split returned no pane_id' }
    $quoted = $LogFile.Replace("'", "''")
    & herdr pane run $id "pwsh -NoProfile -Command `"Get-Content -Tail 40 -Wait '$quoted'`"" 2>$null | Out-Null
    & herdr pane rename $id $script:LogPaneLabel 2>$null | Out-Null
  } catch { Write-Verbose "log pane not opened: $_" }
}
