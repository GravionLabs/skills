function deliver-loop {
  [Diagnostics.CodeAnalysis.SuppressMessageAttribute('PSUseApprovedVerbs', '')]
  param()
  $root = (& git rev-parse --show-toplevel 2>$null)
  if (-not $root) { $root = (Get-Location).Path }
  $dir = $null
  foreach ($d in @((Join-Path $root '.claude/skills/deliver'), (Join-Path $root '.agents/skills/deliver'), (Join-Path $HOME '.claude/skills/deliver'), (Join-Path $HOME '.agents/skills/deliver'))) {
    if (Test-Path -LiteralPath (Join-Path $d 'scripts/Invoke-DeliverLoop.ps1') -PathType Leaf) { $dir = $d; break }
  }
  if (-not $dir) {
    [Console]::Error.WriteLine('deliver-loop: no installed deliver skill found (run /skills-manage delivery).')
    $global:LASTEXITCODE = 1
    return
  }
  if ($args.Count -gt 0 -and "$($args[0])" -eq 'stop') {
    $stopArgs = @($args | Select-Object -Skip 1 | ForEach-Object { switch ("$_") { '--now' { '-Now' } '--cancel' { '-Cancel' } default { "$_" } } })
    Push-Location -LiteralPath $root
    try { & pwsh -NoProfile -File (Join-Path $dir 'scripts/Request-LoopStop.ps1') @stopArgs } finally { Pop-Location }
    return
  }
  if ($args.Count -gt 0 -and "$($args[0])" -in 'takeover', 'release') {
    $runnerArgs = @($args | ForEach-Object { "$_" })
    Push-Location -LiteralPath $root
    try { & pwsh -NoProfile -File (Join-Path $dir 'scripts/Set-ObjectiveRunner.ps1') @runnerArgs } finally { Pop-Location }
    return
  }
  $start = Join-Path $dir 'scripts/Start-LoopWorkspace.ps1'
  if ($env:HERDR_ENV -eq '1' -and (Get-Command herdr -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $start)) {
    # an array argument (-Target 12,14) would reach the native pwsh as separate words: pass it as one comma-joined value
    $nativeArgs = @($args | ForEach-Object { if ($_ -is [array]) { $_ -join ',' } else { "$_" } })
    & pwsh -NoProfile -File $start -ShimCwd $root -ShimScript (Join-Path $dir 'scripts/Invoke-DeliverLoop.ps1') @nativeArgs
    if ($LASTEXITCODE -eq 0) { return }
  }
  # the loop runs in the repository root (git toplevel), also from a subdirectory
  Push-Location -LiteralPath $root
  try { & (Join-Path $dir 'scripts/Invoke-DeliverLoop.ps1') @args } finally { Pop-Location }
}
