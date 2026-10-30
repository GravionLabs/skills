#!/usr/bin/env pwsh
#Requires -Version 7.0
<#
.SYNOPSIS
  Runs the skill trigger evals headless with `claude -p` and scores which skill was chosen.
.DESCRIPTION
  Reads evals/skill-triggers.json, sends every prompt -Runs times to
  `claude -p --output-format stream-json --verbose`, detects Skill tool_use calls and scores them
  with scripts/skill-trigger-score.mjs (plain Node, no build).
  -DryRun / -WhatIf lists the prompts and the command without calling claude. Skills must be installed
  (`npx skills add GravionLabs/skills`) in the directory the script runs from. See docs/usage/trigger-evals.md.
.PARAMETER Runs     Repeats per prompt (default 3).
.PARAMETER Out      Results JSON (default evals/results/trigger-results.json).
.PARAMETER Baseline Earlier results JSON; fail when a rate drops more than 5 points.
.PARAMETER DryRun   List the prompts and the command, call nothing (also -WhatIf).
.PARAMETER Skill    Only evaluate these skills.
.PARAMETER Model    Model alias passed to claude (default sonnet; haiku rarely consults skills); recorded in the results.
.PARAMETER ThrottleLimit Parallel claude sessions (default 8).
.PARAMETER MaxTurns Turn cap per session (default 4: enough for the Skill tool_use event).
#>
[CmdletBinding(SupportsShouldProcess)]
param(
  [int]$Runs = 3,
  [string]$Out = 'evals/results/trigger-results.json',
  [string]$Baseline,
  [string[]]$Skill,
  [string]$Model = 'sonnet',
  [int]$ThrottleLimit = 8,
  [int]$MaxTurns = 4,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$evals = Get-Content (Join-Path $root 'evals/skill-triggers.json') -Raw | ConvertFrom-Json
if ($Skill) { $Skill = @($Skill | ForEach-Object { $_ -split ',' }); $evals = $evals | Where-Object { $_.skill -in $Skill } }
# A skill that is not installed cannot trigger: skip it instead of scoring 0 %.
$skillDirs = @((Join-Path (Get-Location) '.claude/skills'), (Join-Path (Get-Location) '.agents/skills'), (Join-Path $HOME '.claude/skills'), (Join-Path $HOME '.agents/skills'))
$isInstalled = { param($n) [bool]($skillDirs | Where-Object { Test-Path (Join-Path $_ $n) }) }
$notInstalled = @($evals | Where-Object { -not (& $isInstalled $_.skill) } | ForEach-Object { $_.skill })
$evals = @($evals | Where-Object { $_.skill -notin $notInstalled })
# Read-only allow-list plus a deny list as a second fence, so an eval session cannot change the repo.
$safety = @('--tools', 'Skill,Read,Glob,Grep', '--disallowedTools', 'Edit', 'Write', 'MultiEdit', 'Bash', 'NotebookEdit', 'Task', 'WebFetch', 'WebSearch')
$claudeArgs = @('-p', '<prompt>', '--output-format', 'stream-json', '--verbose', '--model', $Model, '--max-turns', $MaxTurns) + $safety
$scorer = Join-Path $root 'scripts/skill-trigger-score.mjs'

$cases = foreach ($e in $evals) {
  foreach ($p in $e.shouldTrigger) { [pscustomobject]@{ skill = $e.skill; kind = 'positive'; prompt = $p } }
  foreach ($p in $e.shouldNotTrigger) { [pscustomobject]@{ skill = $e.skill; kind = 'negative'; prompt = $p } }
}

if ($DryRun -or $WhatIfPreference) {
  if ($notInstalled) { Write-Host "Not installed (skipped): $($notInstalled -join ', ')" }
  Write-Host "Command: claude $($claudeArgs -join ' ')  (x$Runs per prompt, $(@($cases).Count * $Runs) calls)"
  foreach ($c in $cases) { Write-Host "[$($c.kind)] $($c.skill): $($c.prompt)" }
  return
}

if (-not (Test-Path $scorer)) { throw "Missing $scorer." }
$tmp = Join-Path ([IO.Path]::GetTempPath()) "trigger-evals-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory $tmp | Out-Null
try {
  $jobs = @(foreach ($c in $cases) { foreach ($i in 1..$Runs) { [pscustomobject]@{ c = $c; n = 0 } } })
  for ($k = 0; $k -lt $jobs.Count; $k++) { $jobs[$k].n = $k }
  $records = $jobs | ForEach-Object -ThrottleLimit $ThrottleLimit -Parallel {
    $job = $_
    $c = $job.c
    $t = Join-Path $using:tmp "transcript-$($job.n).jsonl"
    $analysis = $null
    foreach ($attempt in 1..2) {   # a failed session (auth, rate limit, crash) is retried once
      $null | & claude -p $c.prompt --output-format stream-json --verbose --model $using:Model --max-turns $using:MaxTurns @using:safety > $t 2>$null
      $json = node $using:scorer extract $t
      $analysis = if ($LASTEXITCODE -eq 0 -and $json) { $json | ConvertFrom-Json } else { [pscustomobject]@{ invoked = @(); failed = $true } }
      if (-not $analysis.failed) { break }
    }
    [pscustomobject]@{ skill = $c.skill; kind = $c.kind; prompt = $c.prompt; invoked = @($analysis.invoked); failed = [bool]$analysis.failed }
  }
  $meta = [ordered]@{ date = (Get-Date -Format 'yyyy-MM-dd'); model = $Model; runs = $Runs; maxTurns = $MaxTurns }
  $recFile = Join-Path $tmp 'records.json'
  ConvertTo-Json -InputObject ([ordered]@{ records = @($records); meta = $meta; notInstalled = $notInstalled }) -Depth 6 | Set-Content $recFile
  New-Item -ItemType Directory (Split-Path ([IO.Path]::GetFullPath($Out)) -Parent) -Force | Out-Null
  $scoreArgs = @('score', $recFile, $Out)
  if ($Baseline) { $scoreArgs += $Baseline }
  node $scorer @scoreArgs
  $code = $LASTEXITCODE
  # Exit codes of the scorer: 0 ok, 1 threshold or regression failure, 2 crash / bad input / too many failed sessions.
  if ($code -ge 2) { Write-Error "Scorer failed (exit $code), see the message above." }
  exit $code
}
finally { Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue }
