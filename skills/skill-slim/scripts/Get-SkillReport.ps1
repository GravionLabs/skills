<#
.SYNOPSIS
  Report skill size and cross-skill problems as JSON (read-only).

.DESCRIPTION
  Scans every SKILL.md under skills/<name>/ of -Root
  and reports: size per skill, skills over the line limit, dangling skill/file references
  (candidates), and lines duplicated across skills.
  References are read from SKILL.md and every references/*.md. A `references/<file>` (or scripts/, templates/,
  assets/) path is resolved in the own skill first, then in a skill named in the same sentence
  (`` `<skill>` `references/<file>` ``); `<skill>/references/<file>`, `../<skill>/...` and repo-root paths
  (docs/..., scripts/..., AGENTS.md, README.md, CONTRIBUTING.md) are resolved against all skills and -Root.

.PARAMETER Root
  Repository root. Defaults to the current directory.

.PARAMETER LineLimit
  SKILL.md line limit. Default 100.

.PARAMETER MinDuplicateLength
  Minimum trimmed line length counted as a duplicate. Default 60.

.PARAMETER FailOnDangling
  Exit 1 when danglingCandidates is not empty (after the allowlist). The JSON is printed anyway.

.PARAMETER Allowlist
  File with known false positives, one `skill: ref` per line (as printed in danglingCandidates); `#` starts a
  comment. Default: skill-report-allowlist.txt next to this script.

.OUTPUTS
  JSON to stdout; diagnostics to stderr. Non-zero exit if -Root is invalid.
#>
param(
  [string]$Root = '.',
  [int]$LineLimit = 100,
  [int]$MinDuplicateLength = 60,
  [switch]$FailOnDangling,
  [string]$Allowlist = (Join-Path $PSScriptRoot 'skill-report-allowlist.txt')
)

$ErrorActionPreference = 'Stop'
if (-not (Test-Path $Root -PathType Container)) { Write-Error "Root '$Root' is not a directory."; exit 1 }
$Root = (Resolve-Path $Root).Path

$skillFiles = @()
$skillsDir = Join-Path $Root 'skills'
if (Test-Path $skillsDir) {
  $skillFiles += Get-ChildItem -Path $skillsDir -Directory | ForEach-Object { Join-Path $_.FullName 'SKILL.md' } |
    Where-Object { Test-Path $_ } | ForEach-Object { Get-Item $_ }
}

$names = @{}
foreach ($f in $skillFiles) { $names[$f.Directory.Name] = $true }
$families = $names.Keys | ForEach-Object { ($_ -split '-')[0] } | Sort-Object -Unique

$skills = foreach ($f in $skillFiles) {
  $dir = $f.Directory.FullName
  $lines = Get-Content $f.FullName
  $refBytes = (Get-ChildItem $dir -Recurse -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -ne 'SKILL.md' } | Measure-Object Length -Sum).Sum
  [pscustomobject]@{
    name = $f.Directory.Name
    path = $f.FullName.Substring($Root.Length + 1)
    lines = $lines.Count
    bytes = $f.Length
    supportBytes = [int]($refBytes ?? 0)
    overLimit = ($lines.Count -gt $LineLimit)
  }
}

$dangling = @()
$lineMap = @{}
$skillDirs = @{}
foreach ($f in $skillFiles) { $skillDirs[$f.Directory.Name] = $f.Directory.FullName }
$rootDocs = '`((?:docs/[\w./-]+|AGENTS\.md|README\.md|CONTRIBUTING\.md))`'
$localPath = '`(?:(?<pre>\.\./[\w-]+/|[\w-]+/)?(?<p>(?:references|assets|templates|scripts)/[\w./-]+))`|\]\((?<pre2>\.\./[\w-]+/)?(?<p2>(?:references|assets|templates|scripts)/[^)#\s]+)\)'

function Add-Dangling($skill, $kind, $ref) { $script:dangling += [pscustomobject]@{ skill = $skill; kind = $kind; ref = $ref } }

foreach ($f in $skillFiles) {
  $dir = $f.Directory.FullName
  $skill = $f.Directory.Name
  $docs = @($f)
  $refDir = Join-Path $dir 'references'
  if (Test-Path $refDir) { $docs += Get-ChildItem $refDir -Recurse -File -Filter *.md }
  foreach ($doc in $docs) {
    $text = Get-Content $doc.FullName -Raw
    foreach ($m in [regex]::Matches($text, '`([a-z0-9]+(?:-[a-z0-9]+)+)`')) {
      $tok = $m.Groups[1].Value
      if (-not $names.ContainsKey($tok) -and $families -contains ($tok -split '-')[0]) { Add-Dangling $skill 'skill-name' $tok }
    }
    foreach ($m in [regex]::Matches($text, $rootDocs)) {
      $p = $m.Groups[1].Value
      if ($p -match '[<{*]') { continue }
      if (-not (Test-Path (Join-Path $Root $p))) { Add-Dangling $skill 'file' $p }
    }
    foreach ($m in [regex]::Matches($text, $localPath)) {
      $p = if ($m.Groups['p'].Success) { $m.Groups['p'].Value } else { $m.Groups['p2'].Value }
      $pre = if ($m.Groups['p'].Success) { $m.Groups['pre'].Value } else { $m.Groups['pre2'].Value }
      if ($p -match '[<{*]') { continue }
      $prefix = $pre.TrimEnd('/') -replace '^\.\./', ''
      if ($prefix) {
        # <skill>/references/x or ../<skill>/references/x; any other prefix (a path of another tool) is not ours
        if (-not $skillDirs.ContainsKey($prefix)) { continue }
        if (-not (Test-Path (Join-Path $skillDirs[$prefix] $p))) { Add-Dangling $skill 'cross-skill' "$prefix/$p" }
        continue
      }
      if (Test-Path (Join-Path $dir $p)) { continue }
      # a skill named in the same sentence owns the path
      $before = $text.Substring(0, $m.Index)
      $cut = (@($before.LastIndexOf('. '), $before.LastIndexOf(".`n"), $before.LastIndexOf("`n`n")) | Measure-Object -Maximum).Maximum
      $sentence = $before.Substring([Math]::Max($cut, 0))
      $owners = @([regex]::Matches($sentence, '`([a-z0-9]+(?:-[a-z0-9]+)*)`') | ForEach-Object { $_.Groups[1].Value } |
        Where-Object { $skillDirs.ContainsKey($_) -and $_ -ne $skill } | Select-Object -Unique)
      if ($owners.Count -gt 0) {
        if (-not ($owners | Where-Object { Test-Path (Join-Path $skillDirs[$_] $p) })) { Add-Dangling $skill 'cross-skill' "$($owners[-1])/$p" }
        continue
      }
      if ($p.StartsWith('scripts/') -and (Test-Path (Join-Path $Root $p))) { continue }
      Add-Dangling $skill 'file' $p
    }
  }
  foreach ($file in Get-ChildItem $dir -Recurse -File -Include *.md) {
    foreach ($l in Get-Content $file.FullName) {
      $t = $l.Trim()
      if ($t.Length -lt $MinDuplicateLength -or $t -match '^(\||```|---|#)') { continue }
      if (-not $lineMap.ContainsKey($t)) { $lineMap[$t] = [System.Collections.Generic.HashSet[string]]::new() }
      [void]$lineMap[$t].Add($f.Directory.Name)
    }
  }
}

$allowed = @{}
if (Test-Path $Allowlist) {
  foreach ($l in Get-Content $Allowlist) {
    $e = ($l -replace '\s+#.*$', '').Trim()
    if ($e -and -not $e.StartsWith('#')) { $allowed[$e] = $true }
  }
}
$dangling = @($dangling | Where-Object { -not $allowed.ContainsKey("$($_.skill): $($_.ref)") })

$duplicates = $lineMap.GetEnumerator() | Where-Object { $_.Value.Count -gt 1 } |
  Sort-Object { $_.Value.Count } -Descending | Select-Object -First 25 |
  ForEach-Object { [pscustomobject]@{ skills = @($_.Value | Sort-Object); line = $_.Key } }

[Console]::Error.WriteLine("scanned $($skillFiles.Count) skills")
[pscustomobject]@{
  limit = $LineLimit
  totalSkills = $skills.Count
  totalSkillBytes = ($skills | Measure-Object bytes -Sum).Sum
  totalSupportBytes = ($skills | Measure-Object supportBytes -Sum).Sum
  largest = @($skills | Sort-Object lines -Descending | Select-Object -First 10)
  overLimit = @($skills | Where-Object overLimit | Select-Object name, lines)
  danglingCandidates = @($dangling | Sort-Object skill, ref -Unique)
  duplicatedLines = @($duplicates)
} | ConvertTo-Json -Depth 6
if ($FailOnDangling -and $dangling.Count -gt 0) {
  Write-Error "dangling references: $($dangling.Count) (see danglingCandidates; false positives go to skill-report-allowlist.txt)" -ErrorAction Continue
  exit 1
}
