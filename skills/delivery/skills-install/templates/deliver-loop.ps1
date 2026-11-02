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
    [Console]::Error.WriteLine('deliver-loop: no installed deliver skill found (run /skills-install delivery).')
    $global:LASTEXITCODE = 1
    return
  }
  $start = Join-Path $dir 'scripts/Start-LoopWorkspace.ps1'
  if ($env:HERDR_ENV -eq '1' -and (Get-Command herdr -ErrorAction SilentlyContinue) -and (Test-Path -LiteralPath $start)) {
    & pwsh -NoProfile -File $start -ShimCwd (Get-Location).Path -ShimScript (Join-Path $dir 'scripts/Invoke-DeliverLoop.ps1') @args
    if ($LASTEXITCODE -eq 0) { return }
  }
  & (Join-Path $dir 'scripts/Invoke-DeliverLoop.ps1') @args
}
