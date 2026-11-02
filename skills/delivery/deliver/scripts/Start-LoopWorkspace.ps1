<#
.SYNOPSIS
  Starts Invoke-DeliverLoop.ps1 in its own herdr workspace "<repo> · deliver" (tab "deliver-loop").
.DESCRIPTION
  Called by the deliver-loop shell shim in herdr (HERDR_ENV=1). The herdr sidebar shows one state per
  workspace by the selected tab, so the loop gets a workspace of its own instead of a tab beside the
  agent session. All other arguments go to Invoke-DeliverLoop.ps1. Exit 0 once the command is queued,
  1 when herdr fails (the shim then runs the loop in the current terminal).
.PARAMETER ShimCwd
  Repository directory; the workspace and the loop start there.
.PARAMETER ShimScript
  Full path of the installed Invoke-DeliverLoop.ps1.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$ShimCwd,
  [Parameter(Mandatory)][string]$ShimScript,
  [Parameter(ValueFromRemainingArguments)][string[]]$LoopArgs = @()
)

$ErrorActionPreference = 'Stop'

function Get-Id($o, [string]$name) {
  foreach ($k in @("${name}_id", 'id')) { if ($o.PSObject.Properties[$k]) { return [string]$o.$k } }
  return [string]$o
}

function ConvertTo-ShellWord([string]$s) { "'" + ($s -replace "'", "'\''") + "'" }

try {
  $top = (& git -C $ShimCwd rev-parse --show-toplevel 2>$null)
  $repo = Split-Path -Leaf $(if ($top) { $top } else { $ShimCwd })
  $label = "$repo $([char]0xB7) deliver"

  $r = (& herdr workspace create --cwd $ShimCwd --label $label --no-focus | Out-String | ConvertFrom-Json).result
  $tab = Get-Id $r.tab 'tab'
  $pane = Get-Id $r.root_pane 'pane'
  & herdr tab rename $tab 'deliver-loop' | Out-Null

  $words = @('pwsh', '-NoProfile', '-File', (ConvertTo-ShellWord $ShimScript)) + @($LoopArgs | ForEach-Object { ConvertTo-ShellWord $_ })
  & herdr pane run $pane ($words -join ' ') | Out-Null
  Write-Host "deliver-loop started in herdr workspace '$label' (tab deliver-loop)."
  exit 0
}
catch {
  [Console]::Error.WriteLine("herdr workspace not started: $($_.Exception.Message)")
  exit 1
}
