<#
.SYNOPSIS
  Renders the generated blocks of ROADMAP.md from the roadmap state; shows the diff, writes only with -Write.
.DESCRIPTION
  -State: the JSON of Get-RoadmapState.ps1 (schema/roadmap-state.schema.json) or the path of a file holding it.
  -Path: the ROADMAP.md to update; a missing file starts from templates/ROADMAP.md. Only text between
  `<!-- roadmap:begin <key> -->` and `<!-- roadmap:end -->` is replaced (keys: intro, where, later, plan <M>, done <M>); everything
  else is hand-written and kept. A plan block of a milestone that is no longer open is removed, and the milestone's done block is
  inserted at `<!-- roadmap:slot done -->` (no slot: before `## Later`, else at the end). New plan blocks go to `<!-- roadmap:slot plan -->`.
  Output: the unified diff on stdout; the file is written only with -Write. Details: references/roadmap-md.md.
.PARAMETER State
  JSON string or file path.
.PARAMETER Path
  ROADMAP.md to create or update (default ROADMAP.md).
.PARAMETER Write
  Write the file; without it nothing is written.
.PARAMETER Date
  Date of the intro line (default: today, yyyy-MM-dd).
#>
param(
  [Parameter(Mandatory)][string]$State,
  [string]$Path = 'ROADMAP.md',
  [switch]$Write,
  [string]$Date = (Get-Date -Format 'yyyy-MM-dd')
)
$ErrorActionPreference = 'Stop'

function Fail([string]$m) { Write-Error $m -ErrorAction Continue; exit 1 }

$jsonText = if (Test-Path -PathType Leaf $State) { Get-Content -Raw $State } else { $State }
try { $st = $jsonText | ConvertFrom-Json } catch { Fail "-State is not valid JSON: $($_.Exception.Message)" }
if ($null -eq $st.issues -and $null -eq $st.milestones) { Fail '-State has neither issues nor milestones: expected the output of Get-RoadmapState.ps1' }
$issues = @($st.issues)
$milestones = @($st.milestones)

function Get-Key([string]$title) { if ($title -cmatch '^(M[0-9]+)\b') { $Matches[1] } else { $title } }
function Get-Num([string]$title) { if ($title -cmatch '^M([0-9]+)\b') { [int]$Matches[1] } else { -1 } }
function Get-Cell([string]$s) { ($s -replace '\|', '\|') -replace '\s+', ' ' }
function Get-Table([string[]]$head, $rows) {
  $out = @(('| ' + ($head -join ' | ') + ' |'), ('| ' + (($head | ForEach-Object { '---' }) -join ' | ') + ' |'))
  foreach ($r in $rows) { $out += '| ' + (($r | ForEach-Object { Get-Cell ([string]$_) }) -join ' | ') + ' |' }
  $out -join "`n"
}
function Get-Why($i) {
  $w = @()
  if (@($i.labels) -contains 'needs-decision') { $w += '`needs-decision`' }
  if (@($i.blockedBy).Count) { $w += 'blocked by ' + ((@($i.blockedBy) | ForEach-Object { "#$_" }) -join ', ') }
  $w -join '; '
}

# an issue with an open child is listed through the child
$parents = @{}
foreach ($i in $issues) { if ($i.parent) { $parents[[int]$i.parent] = $true } }
function Test-Leaf($i) { -not $parents.ContainsKey([int]$i.number) }

$blocks = [ordered]@{}
$blocks['intro'] = "Updated $Date. Last release " + $(if ($st.latestTag) { "``$($st.latestTag)``" } else { 'none yet' }) + '.'

$rows = @(foreach ($i in ($issues | Where-Object { $_.level -in 'epic', 'feature' })) {
  $kids = @($issues | Where-Object { $_.parent -eq $i.number } | ForEach-Object { "#$($_.number)" })
  , @("#$($i.number) $($i.title)", $(if ($kids) { 'open: ' + ($kids -join ', ') } else { 'no open children' }), $(if ($i.milestone) { $i.milestone } else { 'not scheduled' }))
})
$blocks['where'] = if ($rows.Count) { Get-Table @('Epic / Feature', 'State', 'Milestone') $rows } else { 'No open Epic or Feature.' }

$later = @(foreach ($i in ($issues | Where-Object { -not $_.milestone -and (Test-Leaf $_) })) {
  $why = Get-Why $i
  , @("#$($i.number)", $i.title, $(if ($why) { $why } else { 'no milestone' }))
})
$blocks['later'] = if ($later.Count) { Get-Table @('Issue', 'Title', 'Why later') $later } else { 'Nothing waits without a milestone.' }

# blockers inside the milestone first, otherwise by number
function Get-PlanOrder($items) {
  $nums = @($items | ForEach-Object { [int]$_.number })
  $left = [System.Collections.Generic.List[object]]::new()
  foreach ($x in ($items | Sort-Object number)) { $left.Add($x) }
  $done = @{}
  $out = @()
  while ($left.Count) {
    $next = $left | Where-Object { -not (@($_.blockedBy) | Where-Object { $nums -contains [int]$_ -and -not $done.ContainsKey([int]$_) }) } | Select-Object -First 1
    if (-not $next) { $next = $left[0] }
    $out += $next
    $done[[int]$next.number] = $true
    [void]$left.Remove($next)
  }
  $out
}

foreach ($m in ($milestones | Sort-Object { Get-Num $_.title }, { $_.title })) {
  $key = Get-Key $m.title
  if ($m.state -eq 'closed') {
    $list = @($m.issues)
    $body = if ($list.Count) { Get-Table @('Issue', 'Title') ($list | ForEach-Object { , @("#$($_.number)", $_.title) }) } else { 'No issues listed.' }
    $blocks["done $key"] = "## Done in $($m.title)`n`n$body"
  }
  else {
    $items = @($issues | Where-Object { $_.milestone -eq $m.title -and (Test-Leaf $_) })
    $n = 0
    $plan = @(foreach ($i in (Get-PlanOrder $items)) {
      $n++
      , @($n, "#$($i.number)", $i.title, $(if ($i.size) { $i.size } else { '?' }), (Get-Why $i))
    })
    $prog = "Progress: $($m.progress) % ($($m.closed) of $($m.open + $m.closed) issues closed)."
    $body = if ($plan.Count) { Get-Table @('Order', 'Issue', 'Title', 'Size', 'Depends on / decision') $plan } else { 'No open issues.' }
    $blocks["plan $key"] = "## $($m.title)`n`n$prog`n`n$body"
  }
}

$full = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
$exists = Test-Path -PathType Leaf $full
$source = if ($exists) { $full } else { Join-Path $PSScriptRoot '../templates/ROADMAP.md' }
$text = (Get-Content -Raw $source) -replace "`r`n", "`n"
$old = if ($exists) { $text } else { '' }

$seen = @{}
$blockRx = '(?s)<!-- roadmap:begin (?<key>[^>]+?) -->\n(?<body>.*?)<!-- roadmap:end -->\n?'
$sb = [System.Text.StringBuilder]::new()
$pos = 0
foreach ($mt in [regex]::Matches($text, $blockRx)) {
  [void]$sb.Append($text.Substring($pos, $mt.Index - $pos))
  $pos = $mt.Index + $mt.Length
  $key = $mt.Groups['key'].Value.Trim()
  if ($blocks.Contains($key)) {
    $seen[$key] = $true
    [void]$sb.Append("<!-- roadmap:begin $key -->`n$($blocks[$key])`n<!-- roadmap:end -->`n")
  }
  # a plan block of a milestone that is no longer open is dropped: its done block takes over
  elseif ($key -notlike 'plan *') { [void]$sb.Append($mt.Value) }
}
$text = $sb.Append($text.Substring($pos)).ToString()

function Add-Block([string]$text, [string]$key, [string]$slot) {
  $b = "<!-- roadmap:begin $key -->`n$($blocks[$key])`n<!-- roadmap:end -->`n`n"
  $sl = "<!-- roadmap:slot $slot -->"
  if ($text.Contains($sl)) { return $text.Replace($sl, $b + $sl) }
  $at = $text.IndexOf("`n## Later")
  if ($at -ge 0) { return $text.Insert($at + 1, $b) }
  $text.TrimEnd("`n") + "`n`n" + $b
}
foreach ($key in $blocks.Keys) {
  if ($seen.ContainsKey($key)) { continue }
  if ($key -like 'done *') { $text = Add-Block $text $key 'done' }
  elseif ($key -like 'plan *') { $text = Add-Block $text $key 'plan' }
  else { [Console]::Error.WriteLine("roadmap: block '$key' not found in $Path, left out") }
}
$text = ($text -replace "\n{3,}", "`n`n").TrimEnd("`n") + "`n"

if ($text -eq $old) { 'roadmap: ROADMAP.md is current, nothing to write'; exit 0 }

$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ('roadmap-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $tmp | Out-Null
try {
  [System.IO.File]::WriteAllText("$tmp/old", $old)
  [System.IO.File]::WriteAllText("$tmp/new", $text)
  $diff = & git diff --no-index --no-color -- "$tmp/old" "$tmp/new" 2>$null
  ($diff | Select-Object -Skip 4) -join "`n"
}
finally { Remove-Item -Recurse -Force $tmp }

if ($Write) {
  [System.IO.File]::WriteAllText($full, $text)
  "roadmap: wrote $Path"
}
else { "roadmap: dry run, $Path not written (use -Write after approval)" }
