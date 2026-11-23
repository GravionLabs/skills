#Requires -Version 7
<#
.SYNOPSIS
Resolves the folder roles, the language and the template folder of a vault as JSON.
.DESCRIPTION
Reads <Vault>/.nixe/config.json (language, folders, files, templates.folder). A role missing in
`folders` gets its English default name; own roles (any other key) are listed with their description.
The template folder comes from templates.folder, then .obsidian/templates.json, then the role templates.
.PARAMETER Vault
Vault root; default is the current directory.
.EXAMPLE
pwsh scripts/Get-VaultRoles.ps1 -Vault ~/vault
#>
[CmdletBinding()]
param([string]$Vault = '.')

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Vault).Path
$defaults = [ordered]@{
  inbox = 'Inbox'; journal = 'Journal'; templates = 'Templates'; attachments = 'Attachments'
  projects = 'Projects'; areas = 'Areas'; resources = 'Resources'; archive = 'Archive'
  clippings = 'Resources/Clippings'; subjects = 'Subjects'; sources = 'Sources'; exams = 'Exams'
}
$cfg = $null
$cfgFile = Join-Path $root '.nixe/config.json'
if (Test-Path -LiteralPath $cfgFile) { $cfg = Get-Content -LiteralPath $cfgFile -Raw | ConvertFrom-Json -AsHashtable }

function Get-Entry($v) {
  if ($v -is [string]) { return @{ path = $v; description = $null } }
  return @{ path = [string]$v.path; description = $v.description }
}

$folders = [ordered]@{}
foreach ($k in $defaults.Keys) { $folders[$k] = @{ path = $defaults[$k]; description = $null; own = $false } }
if ($cfg -and $cfg.folders) {
  foreach ($k in $cfg.folders.Keys) {
    $e = Get-Entry $cfg.folders[$k]
    $folders[$k] = @{ path = $e.path; description = $e.description; own = -not $defaults.Contains($k) }
  }
}
foreach ($k in @($folders.Keys)) {
  $folders[$k].exists = Test-Path -LiteralPath (Join-Path $root $folders[$k].path) -PathType Container
}

$tpl = $null; $tplFrom = 'role'
if ($cfg -and $cfg.templates -and $cfg.templates.folder) { $tpl = [string]$cfg.templates.folder; $tplFrom = '.nixe/config.json' }
else {
  $ot = Join-Path $root '.obsidian/templates.json'
  if (Test-Path -LiteralPath $ot) {
    $f = (Get-Content -LiteralPath $ot -Raw | ConvertFrom-Json).folder
    if ($f) { $tpl = [string]$f; $tplFrom = '.obsidian/templates.json' }
  }
}
if (-not $tpl) { $tpl = $folders['templates'].path }

$files = [ordered]@{ profile = 'Profile.md' }
if ($cfg -and $cfg.files) { foreach ($k in $cfg.files.Keys) { $files[$k] = [string]$cfg.files[$k] } }

[ordered]@{
  language = if ($cfg -and $cfg.language) { [string]$cfg.language } else { 'en' }
  folders = $folders
  files = $files
  templates = [ordered]@{ folder = $tpl; source = $tplFrom }
} | ConvertTo-Json -Depth 5
