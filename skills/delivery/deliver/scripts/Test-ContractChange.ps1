<#
.SYNOPSIS
  Does a PR touch the contract paths of .agents/config.json (deliver step 6)?
.DESCRIPTION
  Matches the changed files against `contracts.paths` (globs: ** any depth, * within a segment, ? one character).
  Prints JSON { configured, hit, count, paths[] }. Without `contracts.paths` (or without the config file)
  configured and hit are false and no PR is read.
.PARAMETER Pr
  PR number; the files come from `gh pr diff <pr> --name-only`.
.PARAMETER Files
  Changed files instead of -Pr (tests).
.PARAMETER Config
  Path of the config file (default .agents/config.json).
#>
[CmdletBinding()]
param([string]$Pr, [string[]]$Files, [string]$Config = '.agents/config.json')

$ErrorActionPreference = 'Stop'
$patterns = @()
if (Test-Path -LiteralPath $Config) {
  $cfg = Get-Content -LiteralPath $Config -Raw | ConvertFrom-Json
  if ($cfg.contracts -and $cfg.contracts.paths) { $patterns = @($cfg.contracts.paths | Where-Object { $_ }) }
}

function ConvertTo-GlobRegex([string]$glob) {
  $g = $glob.Trim().TrimStart('/') -replace '\\', '/'
  $sb = [System.Text.StringBuilder]::new('^')
  for ($i = 0; $i -lt $g.Length; $i++) {
    $c = $g[$i]
    if ($c -eq '*') {
      if ($i + 1 -lt $g.Length -and $g[$i + 1] -eq '*') {
        $i++
        if ($i + 1 -lt $g.Length -and $g[$i + 1] -eq '/') { $i++; [void]$sb.Append('(?:.*/)?') } else { [void]$sb.Append('.*') }
      } else { [void]$sb.Append('[^/]*') }
    } elseif ($c -eq '?') { [void]$sb.Append('[^/]') }
    else { [void]$sb.Append([regex]::Escape([string]$c)) }
  }
  return $sb.Append('$').ToString()
}

$hits = @()
if ($patterns.Count -gt 0) {
  $Files = @($Files | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
  if (-not $Files) {
    if (-not $Pr) { throw 'Pass -Pr or -Files.' }
    $Files = @(& gh pr diff $Pr --name-only)
    if ($LASTEXITCODE -ne 0) { throw "gh pr diff $Pr failed" }
  }
  $regexes = $patterns | ForEach-Object { ConvertTo-GlobRegex $_ }
  $hits = @($Files | ForEach-Object { ($_ -replace '\\', '/') } | Where-Object {
    $f = $_; @($regexes | Where-Object { $f -match $_ }).Count -gt 0 })
}

[pscustomobject]@{
  configured = $patterns.Count -gt 0
  hit        = $hits.Count -gt 0
  count      = $hits.Count
  paths      = $hits
} | ConvertTo-Json -Compress
