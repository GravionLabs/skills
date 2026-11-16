<#
.SYNOPSIS
  `deliver-loop refine`: one model session checks every open PBI and Bug of a set for readiness and collects the open
  questions in one list (#675).
.DESCRIPTION
  Resolves the set (-Milestone or -Target; a Feature or Epic target contributes its open PBIs and Bugs), starts ONE session
  of the harness with `/planner refine --check <nr…> --result <file>` (the read-only readiness check of `planner refine`),
  reads the result file and applies it: a PBI with open questions gets the label `needs-refinement` and one comment with the
  questions; a ready PBI is not changed. Prints the list (ready, or the questions, with the issue URL) and writes it to
  `.agents/deliver-loop/refine/<timestamp>.json`; answer it with `grill-me` on that file.
  Exit codes: 0 list printed (also with open questions), 1 the session produced no usable result, 2 empty set, 64 bad arguments.
.PARAMETER Milestone
  Milestone (M<nnn> or title) whose open PBIs and Bugs are checked.
.PARAMETER Target
  Issue numbers (PBIs, Bugs, or Features/Epics whose open PBIs and Bugs are used).
.PARAMETER Model
  Model of the session. Default: sonnet (claude), auto (copilot).
.PARAMETER Harness
  claude (default) or copilot.
.PARAMETER DryRun
  Prints the set and the command, starts no session and writes nothing.
#>
[CmdletBinding()]
param(
  [string[]]$Target = @(),
  [string]$Milestone = '',
  [string]$Model = '',
  [string]$Harness = 'claude',
  [switch]$DryRun,
  [Parameter(ValueFromRemainingArguments)][string[]]$MoreTargets = @()
)
$ErrorActionPreference = 'Stop'

if ($Harness -notin 'claude', 'copilot') {
  [Console]::Error.WriteLine("Unknown -Harness '$Harness'. Supported: claude, copilot.")
  exit 64
}
$Nrs = @(@($Target) + @($MoreTargets) | ForEach-Object { "$_" -split ',' } | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ })
if (-not $Milestone -and -not $Nrs) {
  [Console]::Error.WriteLine('deliver-loop refine: give -Milestone <M> or -Target <nr…>.')
  exit 64
}
if (-not $Model) { $Model = if ($Harness -eq 'copilot') { 'auto' } else { 'sonnet' } }

function Get-GhJson([string[]]$ghArgs) {
  $out = & gh @ghArgs 2>&1
  if ($LASTEXITCODE -ne 0) { throw "gh $($ghArgs -join ' ') failed: $out" }
  if (-not $out) { return $null }
  ($out -join "`n") | ConvertFrom-Json
}

$MilestoneScript = @('../../github-milestone', '../../../github/github-milestone' | ForEach-Object { Join-Path $PSScriptRoot "$_/scripts/Get-Milestones.ps1" }) |
  Where-Object { Test-Path $_ } | Select-Object -First 1

# the open PBIs and Bugs of the set: nr -> issue (REST only)
$set = [ordered]@{}
$seen = @{}
function Add-Issue([int]$nr) {
  if ($seen.ContainsKey($nr)) { return }
  $seen[$nr] = $true
  $issue = Get-GhJson @('api', "repos/{owner}/{repo}/issues/$nr")
  $labels = @($issue.labels | ForEach-Object { $_.name })
  if ($labels -contains 'pbi' -or $labels -contains 'bug') {
    if ($issue.state -eq 'open') { $set["$nr"] = $issue }
    return
  }
  foreach ($child in @(Get-GhJson @('api', "repos/{owner}/{repo}/issues/$nr/sub_issues?per_page=100"))) {
    if ($child) { Add-Issue ([int]$child.number) }
  }
}
if ($Milestone) {
  if (-not $MilestoneScript) { throw 'github-milestone (Get-Milestones.ps1) not found.' }
  $out = & pwsh -NoProfile -File $MilestoneScript -Mode issues -Name $Milestone -State open
  if ($LASTEXITCODE -ne 0) { throw "Get-Milestones.ps1 failed: $out" }
  foreach ($item in @(($out -join "`n" | ConvertFrom-Json).issues)) {
    if ($item) { Add-Issue ([int]$item.number) }
  }
}
foreach ($nr in $Nrs) { Add-Issue $nr }

if ($set.Count -eq 0) {
  Write-Output 'refine: no open PBI or Bug in the set.'
  exit 2
}
$nrList = ($set.Keys | ForEach-Object { "$_" }) -join ','

$stamp = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssZ')
$dir = Join-Path (Get-Location).Path '.agents/deliver-loop/refine'
$resultFile = Join-Path $dir "result-$stamp.json"
$listFile = Join-Path $dir "$stamp.json"
$prompt = "/planner refine --check $nrList --result $resultFile"
$cli = if ($Harness -eq 'copilot') {
  @('-p', $prompt, '--model', $Model, '--allow-all-tools', '--allow-all-paths', '--allow-all-urls', '--no-ask-user')
} else {
  @('-p', $prompt, '--model', $Model, '--permission-mode', 'auto')
}

Write-Output "refine: $($set.Count) to check (#$($nrList -replace ',', ', #')), one $Harness session, model $Model"
if ($DryRun) {
  Write-Output "dry run: $Harness $($cli -join ' ')"
  exit 0
}

New-Item -ItemType Directory -Force -Path $dir | Out-Null
# the session may be nested in another agent run: it writes no events of this run
$saved = $env:AGENT_EVENTS_OWNER; $env:AGENT_EVENTS_OWNER = ''
try {
  $log = & $Harness @cli 2>&1
  $rc = $LASTEXITCODE
} finally { $env:AGENT_EVENTS_OWNER = $saved }
Set-Content -LiteralPath (Join-Path $dir "session-$stamp.log") -Value $log
if ($rc -ne 0) { Write-Output "refine: $Harness exited with $rc (log: .agents/deliver-loop/refine/session-$stamp.log)" }

$result = $null
if (Test-Path -LiteralPath $resultFile) {
  try { $result = Get-Content -Raw -LiteralPath $resultFile | ConvertFrom-Json } catch { Write-Verbose "result unreadable: $_" }
}
$byNr = @{}
foreach ($r in @($result.items)) {
  if ($r -and "$($r.number)" -match '^\d+$' -and $set.Contains("$($r.number)")) { $byNr[[int]$r.number] = $r }
}
if ($byNr.Count -eq 0) {
  Write-Output "refine: the session wrote no usable result ($resultFile); nothing was changed."
  exit 1
}

# apply: needs-refinement and one comment per PBI with questions; a ready PBI is not touched
$labelChecked = $false
$list = [System.Collections.Generic.List[object]]::new()
foreach ($key in $set.Keys) {
  $nr = [int]$key
  $issue = $set[$key]
  $r = $byNr[$nr]
  if (-not $r) {
    $list.Add([ordered]@{ number = $nr; url = [string]$issue.html_url; status = 'no result'; questions = @() })
    continue
  }
  $questions = @(@($r.questions) | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
  if ($r.ready -eq $true -and -not $questions) {
    $list.Add([ordered]@{ number = $nr; url = [string]$issue.html_url; status = 'ready'; questions = @() })
    continue
  }
  if (-not $questions) { $questions = @('The readiness check found a gap but named no question; run `planner refine` by hand.') }
  if (-not $labelChecked) {
    & gh label create needs-refinement --description 'Open questions before delivery' --color FBCA04 2>&1 | Out-Null
    $labelChecked = $true
  }
  & gh issue edit $nr --add-label needs-refinement 2>&1 | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "gh issue edit #$nr failed" }
  $body = "Open questions before delivery (``deliver-loop refine``):`n`n" + (($questions | ForEach-Object { "- $_" }) -join "`n") +
    "`n`nAnswer them with ``grill-me``; the answers go under ``## Decisions`` of this issue."
  $bodyFile = Join-Path $dir "comment-$nr-$stamp.md"
  Set-Content -LiteralPath $bodyFile -Value $body
  & gh issue comment $nr --body-file $bodyFile 2>&1 | Out-Null
  $cc = $LASTEXITCODE
  Remove-Item -LiteralPath $bodyFile -ErrorAction SilentlyContinue
  if ($cc -ne 0) { throw "gh issue comment #$nr failed" }
  $list.Add([ordered]@{ number = $nr; url = [string]$issue.html_url; status = 'open questions'; questions = $questions })
}

($list | ConvertTo-Json -Depth 5) | Set-Content -LiteralPath $listFile
$ready = @($list | Where-Object { $_.status -eq 'ready' }).Count
Write-Output "refine: $ready ready, $($list.Count - $ready) with open questions or no result"
foreach ($e in $list) {
  if ($e.status -eq 'ready') { Write-Output "ready: #$($e.number) $($e.url)"; continue }
  Write-Output "$($e.status): #$($e.number) $($e.url)"
  foreach ($q in $e.questions) { Write-Output "  - $q" }
}
if ($ready -lt $list.Count) { Write-Output "answer them: /grill-me $((Resolve-Path -Relative -LiteralPath $listFile) -replace '\\', '/')" }
exit 0
