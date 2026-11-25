#Requires -Version 7
<#
.SYNOPSIS
Sets up a vault (PARA or school), sets folder roles and updates the core rules of CLAUDE.md.
.DESCRIPTION
setup <para|school> [-Language en|de]  folders, .nixe/config.json, templates, profile file, CLAUDE.md, skills
                                       Both profiles share one vault: one language (another one is refused), and
                                       school on a vault with the role areas puts subjects below it.
role <name> <path> [description]       set or change a folder role; -List lists, -Remove <name> removes
update                                 npx skills check + update, then the core block of CLAUDE.md
Never overwrites an existing note, never commits. Prints a summary.
The roles attachments and inbox never share a folder: setup and role refuse it, a vault that
already has it gets a warning.
.PARAMETER SkipInstall
Do not run npx skills (tests, offline).
.EXAMPLE
pwsh scripts/Invoke-VaultSetup.ps1 setup school -Language de -Vault ~/vault
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory, Position = 0)][ValidateSet('setup', 'role', 'update')][string]$Command,
  [Parameter(Position = 1)][string]$Arg1,
  [Parameter(Position = 2)][string]$Arg2,
  [Parameter(Position = 3)][string]$Arg3,
  [string]$Vault = '.',
  [string]$Language = '',
  [switch]$List,
  [string]$Remove = '',
  [switch]$SkipInstall
)

$ErrorActionPreference = 'Stop'
$skillDir = Split-Path -Parent $PSScriptRoot
$assets = Join-Path $skillDir 'assets'
$root = (Resolve-Path -LiteralPath $Vault).Path
$cfgFile = Join-Path $root '.nixe/config.json'
$claudeFile = Join-Path $root 'CLAUDE.md'
$startMark = '<!-- vault-core:start -->'
$endMark = '<!-- vault-core:end -->'
$ownHeading = '## Vault-specific rules'
$standard = 'inbox', 'journal', 'templates', 'attachments', 'projects', 'areas', 'resources', 'archive', 'clippings', 'subjects', 'sources', 'exams'
$utf8 = [System.Text.UTF8Encoding]::new($false)
$summary = [System.Collections.Generic.List[string]]::new()

function Read-Text($p) { [System.IO.File]::ReadAllText($p, $utf8) }
function Write-Text($p, $t) {
  $d = Split-Path -Parent $p
  if ($d -and -not (Test-Path -LiteralPath $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
  [System.IO.File]::WriteAllText($p, ($t -replace "`r`n", "`n"), $utf8)
}
function Read-Json($p) { Get-Content -LiteralPath $p -Raw | ConvertFrom-Json -AsHashtable }
function Read-Config { if (Test-Path -LiteralPath $cfgFile) { Read-Json $cfgFile } else { @{} } }
function Save-Config($c) { Write-Text $cfgFile (($c | ConvertTo-Json -Depth 6) + "`n") }
function Add-NoteFile($src, $dest) {
  # never overwrites
  if (Test-Path -LiteralPath $dest) { $summary.Add("kept $([IO.Path]::GetRelativePath($root, $dest))"); return }
  Write-Text $dest (Read-Text $src)
  $summary.Add("created $([IO.Path]::GetRelativePath($root, $dest))")
}
function Test-Inside($rel) {
  if ([IO.Path]::IsPathRooted($rel)) { return $false }
  $full = [IO.Path]::GetFullPath((Join-Path $root $rel))
  $r = $root.TrimEnd('/', '\') + [IO.Path]::DirectorySeparatorChar
  return ($full + [IO.Path]::DirectorySeparatorChar).StartsWith($r) -or $full -eq $root.TrimEnd('/', '\')
}
function Get-Norm($p) { ($p -replace '\\', '/').Trim('/').ToLowerInvariant() }

# The roles inbox and attachments must differ: the import empties the inbox. An unset role is its English default.
function Test-InboxClash($folders) {
  $full = foreach ($k in 'inbox', 'attachments') {
    $v = if ($folders) { $folders[$k] }
    $p = if ($null -eq $v) { $k.Substring(0, 1).ToUpperInvariant() + $k.Substring(1) } elseif ($v -is [string]) { $v } else { [string]$v['path'] }
    [IO.Path]::GetFullPath((Join-Path $root $p)).TrimEnd('/', '\')
  }
  return $full[0] -eq $full[1]
}
function Get-ClashText($lang) {
  $name = if ($lang -eq 'de') { 'Anhänge' } else { 'Attachments' }
  "the roles 'attachments' and 'inbox' point to the same folder (the import empties the inbox, attachments must stay). Proposal: role attachments $name"
}

function Get-CoreBlock {
  $body = (Read-Text (Join-Path $assets 'core/CLAUDE-core.md')).Trim()
  "$startMark`n$body`n$endMark"
}

# Replaces the core block; returns inserted | replaced | unchanged | created. The text outside the markers is never touched.
function Set-CoreBlock {
  $block = Get-CoreBlock
  if (-not (Test-Path -LiteralPath $claudeFile)) {
    Write-Text $claudeFile "# Vault`n`n$block`n`n$ownHeading`n"
    return 'created'
  }
  $text = (Read-Text $claudeFile) -replace "`r`n", "`n"
  $rx = [regex]::new('(?s)' + [regex]::Escape($startMark) + '.*?' + [regex]::Escape($endMark))
  if ($rx.IsMatch($text)) {
    $new = $rx.Replace($text, { param($m) $block }, 1)
    if ($new -ceq $text) { return 'unchanged' }
    Write-Text $claudeFile $new
    return 'replaced'
  }
  # block missing: insert it after the first heading line, else at the top
  $lines = [System.Collections.Generic.List[string]]($text -split "`n")
  $at = 0
  if ($lines.Count -gt 0 -and $lines[0] -match '^# ') { $at = 1 }
  $lines.Insert($at, "`n$block`n")
  Write-Text $claudeFile (($lines -join "`n").TrimEnd() + "`n")
  return 'inserted'
}

function Invoke-Skills($argv, $what) {
  if ($SkipInstall) { $summary.Add("skipped npx skills ($what)"); return }
  if (-not (Get-Command npx -ErrorAction SilentlyContinue)) { Write-Warning "npx not found: $what not run"; $summary.Add("npx missing: $what not run"); return }
  Push-Location $root
  try {
    & npx skills @argv
    if ($LASTEXITCODE -ne 0) { Write-Warning "npx skills $($argv -join ' ') exited with $LASTEXITCODE"; $summary.Add("npx skills $($argv[0]) failed ($LASTEXITCODE)") }
    else { $summary.Add("npx skills $($argv[0]) done") }
  } finally { Pop-Location }
}

function Find-SchoolAssets {
  $cands = @(
    (Join-Path $root '.claude/skills/school-summary'), (Join-Path $root '.agents/skills/school-summary'),
    (Join-Path $skillDir '../school-summary'), (Join-Path $skillDir '../../school/school-summary')
  )
  foreach ($c in $cands) { if (Test-Path -LiteralPath (Join-Path $c 'assets') -PathType Container) { return (Join-Path $c 'assets') } }
  throw 'school-summary assets not found: install the school skills first (npx skills add GravionLabs/skills --skill school-summary)'
}

function Invoke-Setup {
  $kind = $Arg1
  if ($kind -notin 'para', 'school') { throw "setup needs a profile: para or school (got '$kind')" }
  # one vault has one language: without -Language the vault's language counts, another one is refused before anything is written
  $current = [string](Read-Config)['language']
  $lang = if ($Language) { $Language.ToLowerInvariant() } elseif ($current) { $current.ToLowerInvariant() } else { 'en' }
  if ($current -and $lang -ne $current.ToLowerInvariant()) {
    throw "setup refused, nothing changed: the vault's language is '$current', not '$lang'. All profiles of a vault share one language: run setup $kind -Language $current"
  }
  $assetLang = $lang
  if ($lang -notin 'en', 'de') {
    $assetLang = 'en'
    Write-Warning "Language '$lang' ships no folder names yet: English folder names and templates are used, notes are written in '$lang'."
    $summary.Add("notice: language $lang falls back to English folder names")
  }
  $profiles = Read-Json (Join-Path $assets 'profiles.json')

  # 1. skills first (the school assets come from school-summary)
  $argv = @('add', 'GravionLabs/skills')
  foreach ($s in $profiles[$kind].skills) { $argv += '--skill'; $argv += $s }
  $argv += '-y'
  Invoke-Skills $argv "install of the $kind skills"

  # 2. folders and templates source
  if ($kind -eq 'school') {
    $src = Join-Path (Find-SchoolAssets) $assetLang
    $new = Read-Json (Join-Path $src 'folders.json')
  } else {
    $src = Join-Path $assets $assetLang
    $new = Read-Json (Join-Path $src 'folders.json')
  }

  # 3. config: an existing value is kept, a missing one is added
  New-Item -ItemType Directory -Path (Join-Path $root '.nixe') -Force | Out-Null
  $cfg = Read-Config
  $clashed = Test-InboxClash $cfg['folders']
  $cfg['language'] = $lang
  if ($kind -eq 'school') {
    # in a PARA vault the school is one area: subjects goes below areas, not to the vault root
    if ($cfg['folders'] -and $cfg['folders']['areas']) {
      $v = $cfg['folders']['areas']
      $areas = if ($v -is [string]) { $v } else { [string]$v['path'] }
      $areas = ($areas -replace '\\', '/').TrimEnd('/')
      $name = if ($assetLang -eq 'de') { 'Schule' } else { 'School' }
      $new['folders']['subjects'] = if ($areas -in '', '.') { $name } else { "$areas/$name" }
    }
    # an older vault names the school profile files.profile: keep using it, add no second key
    if ($cfg['files'] -and $cfg['files']['profile'] -and -not $cfg['files']['school-profile']) {
      $new.Remove('files')
      $summary.Add('kept files.profile of the existing config as the school profile')
    }
  }
  foreach ($k in 'folders', 'files', 'templates') {
    if (-not $new.ContainsKey($k)) { continue }
    if (-not $cfg.ContainsKey($k) -or $null -eq $cfg[$k]) { $cfg[$k] = @{} }
    foreach ($e in $new[$k].Keys) {
      if ($cfg[$k].ContainsKey($e)) { $summary.Add("kept $k.$e of the existing config") }
      else { $cfg[$k][$e] = $new[$k][$e] }
    }
  }
  if (-not $clashed -and (Test-InboxClash $cfg['folders'])) { throw "setup refused, config not written: $(Get-ClashText $lang)" }
  $ordered = [ordered]@{}
  foreach ($k in 'language', 'folders', 'files', 'templates') { if ($cfg.ContainsKey($k)) { $ordered[$k] = $cfg[$k] } }
  foreach ($k in $cfg.Keys) { if (-not $ordered.Contains($k)) { $ordered[$k] = $cfg[$k] } }
  Save-Config $ordered
  $summary.Add('wrote .nixe/config.json')

  # 4. folders from the effective config
  foreach ($k in $cfg['folders'].Keys) {
    $v = $cfg['folders'][$k]
    $p = if ($v -is [string]) { $v } else { [string]$v['path'] }
    if (-not (Test-Inside $p)) { throw "folder role '$k' points outside the vault: $p" }
    $full = Join-Path $root $p
    if (-not (Test-Path -LiteralPath $full)) { New-Item -ItemType Directory -Path $full -Force | Out-Null; $summary.Add("created folder $p") }
  }
  $tplDir = if ($cfg['templates'] -and $cfg['templates']['folder']) { [string]$cfg['templates']['folder'] } else { [string]$new['folders']['templates'] }
  New-Item -ItemType Directory -Path (Join-Path $root $tplDir) -Force | Out-Null

  # 5. templates, profile file, CLAUDE.md profile section
  if ($kind -eq 'para') {
    foreach ($f in Get-ChildItem -LiteralPath (Join-Path $src 'templates') -File) { Add-NoteFile $f.FullName (Join-Path $root "$tplDir/$($f.Name)") }
    $section = Read-Text (Join-Path $src 'CLAUDE-para.md')
  } else {
    $examName = if ($assetLang -eq 'de') { 'Prüfung.md' } else { 'Exam.md' }
    Add-NoteFile (Join-Path $src 'Exam.md') (Join-Path $root "$tplDir/$examName")
    $profName = [string]$cfg['files']['school-profile']
    if (-not $profName) { $profName = [string]$cfg['files']['profile'] }
    Add-NoteFile (Join-Path $src 'Profile.md') (Join-Path $root $profName)
    $section = Read-Text (Join-Path $src 'CLAUDE-school.md')
  }
  $core = Set-CoreBlock
  $summary.Add("CLAUDE.md core block: $core")
  $text = (Read-Text $claudeFile) -replace "`r`n", "`n"
  $first = ($section.Trim() -split "`n")[0]
  # headings of earlier versions of the section count too: no second school section
  $known = @($first)
  if ($kind -eq 'school') { $known += '## School vault', '## Schul-Vault' }
  if ($known | Where-Object { $text -match "(?m)^$([regex]::Escape($_))\s*$" }) { $summary.Add('CLAUDE.md profile section: kept') }
  else {
    if ($text -notmatch [regex]::Escape($ownHeading)) { $text = $text.TrimEnd() + "`n`n$ownHeading`n" }
    Write-Text $claudeFile ($text.TrimEnd() + "`n`n" + $section.Trim() + "`n")
    $summary.Add('CLAUDE.md profile section: added')
  }
}

function Invoke-Role {
  $cfg = Read-Config
  if (-not $cfg.ContainsKey('folders') -or $null -eq $cfg['folders']) { $cfg['folders'] = @{} }
  $folders = $cfg['folders']
  $path = { param($v) if ($v -is [string]) { $v } else { [string]$v['path'] } }
  if ($List) {
    foreach ($k in $folders.Keys | Sort-Object) {
      $v = $folders[$k]; $d = if ($v -is [string]) { '' } else { [string]$v['description'] }
      $summary.Add(("{0}`t{1}`t{2}" -f $k, (& $path $v), $d))
    }
    if ($summary.Count -eq 0) { $summary.Add('no roles set (the standard roles use their English folder names)') }
    return
  }
  if ($Remove) {
    if (-not $folders.ContainsKey($Remove)) { throw "role '$Remove' is not set" }
    $clashed = Test-InboxClash $folders
    $folders.Remove($Remove)
    if (-not $clashed -and (Test-InboxClash $folders)) { throw "role '$Remove' not removed: $(Get-ClashText $cfg['language'])" }
    Save-Config $cfg
    $summary.Add("removed role $Remove (the folder stays)")
    return
  }
  $name = $Arg1; $rel = $Arg2; $desc = $Arg3
  if (-not $name -or -not $rel) { throw 'role needs <name> <path> [description], -List or -Remove <name>' }
  if ($name -cnotmatch '^[a-z][a-z0-9-]*$') { throw "role name '$name' must be lower case letters, digits and '-'" }
  if (-not (Test-Inside $rel)) { throw "path '$rel' is outside the vault" }
  $isOwn = $name -notin $standard
  if ($isOwn -and -not $desc) { throw "own role '$name' needs a description (what belongs in the folder)" }
  if ($name -in 'inbox', 'attachments') {
    $next = @{ inbox = $folders['inbox']; attachments = $folders['attachments'] }
    $next[$name] = $rel
    if (Test-InboxClash $next) { throw "path '$rel' refused: $(Get-ClashText $cfg['language'])" }
  }
  foreach ($k in $folders.Keys) {
    if ($k -ne $name -and (Get-Norm (& $path $folders[$k])) -eq (Get-Norm $rel)) { throw "folder '$rel' already has the role '$k' (one role per folder)" }
  }
  $folders[$name] = if ($desc) { [ordered]@{ path = $rel; description = $desc } } else { $rel }
  New-Item -ItemType Directory -Path (Join-Path $root $rel) -Force | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $root '.nixe') -Force | Out-Null
  Save-Config $cfg
  $summary.Add("role $name -> $rel")
}

function Invoke-Update {
  Invoke-Skills @('check') 'check'
  Invoke-Skills @('update', '-y') 'update'
  $r = Set-CoreBlock
  $summary.Add("CLAUDE.md core block: $r")
  $summary.Add('no commit: the user or the Git sync commits')
}

switch ($Command) {
  'setup' { Invoke-Setup }
  'role' { Invoke-Role }
  'update' { Invoke-Update }
}
# a broken config must not fail 'update', which does not need it
$final = try { Read-Config } catch { Write-Warning ".nixe/config.json not readable: $_"; @{} }
if ($final.Count -gt 0 -and (Test-InboxClash $final['folders'])) {
  $text = Get-ClashText $final['language']
  Write-Warning $text
  $summary.Add("warning: $text")
}
$summary | ForEach-Object { Write-Output $_ }
