<#
.SYNOPSIS
  Plans (default, dry run) or applies the base files of a project: .gitattributes, .gitignore per language and the pre-commit hook.
.DESCRIPTION
  Prints the plan as JSON. Without -Apply nothing is written.
  .gitattributes: created from templates/gitattributes when missing; an existing file gets only the missing lines appended (shown in the plan as `missing`).
  .gitignore: per detected language the entries of templates/gitignore/<lang>.gitignore (ts, ng and js share `ts`) that are not yet in the file, under a `# <lang> (project-setup)` header.
  Hook: a repository with only ts/ng/js languages delegates to the skill setup-biome-husky (ng or a prettier config: setup-prettier-eslint-husky);
  any repository with another language gets one lefthook.yml for all its languages. An existing .husky/ or lefthook.yml is reported and left unchanged.
  A missing lefthook is reported with its install hint, never installed.
.PARAMETER ProjectRoot
  Project root (default: current directory).
.PARAMETER StackJson
  A detect-techstack report (JSON text) instead of running the detection.
.PARAMETER ImplementationDir
  Directory of the installed `implementation` skill as the hook calls it, relative to the repository root.
.PARAMETER Apply
  Write the changes.
#>
[CmdletBinding()]
param(
  [string]$ProjectRoot = '.',
  [string]$StackJson,
  [string]$ImplementationDir = '.claude/skills/implementation',
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail([string]$Message) {
  Write-Error "Add-BaseFiles: $Message" -ErrorAction Continue
  exit 1
}

$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$skillDir = Split-Path -Parent $PSScriptRoot
$utf8 = [System.Text.UTF8Encoding]::new($false)

function Get-Stack {
  if ($StackJson) { $json = $StackJson } else {
    $detect = @(
      (Join-Path $skillDir '../detect-techstack/scripts/Detect-TechStack.ps1')
      (Join-Path $skillDir '../../shared/detect-techstack/scripts/Detect-TechStack.ps1')
    ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
    if (-not $detect) { Fail 'detect-techstack not found next to project-setup; run /skills-manage shared' }
    $json = & $detect -ProjectRoot $root
    if ($LASTEXITCODE -ne 0) { Fail 'detect-techstack failed' }
  }
  $report = ($json | Out-String) | ConvertFrom-Json
  $frameworks = @($report.frameworks)
  $keys = [System.Collections.Generic.List[string]]::new()
  foreach ($l in @($report.languages)) {
    $k = switch ($l) { 'js' { 'ts' } default { $l } }
    if ($k -eq 'ts' -and $frameworks -contains 'angular') { $k = 'ng' }
    if (@('ts', 'ng', 'py', 'dotnet', 'rust', 'go') -contains $k -and -not $keys.Contains($k)) { $keys.Add($k) }
  }
  @($keys)
}

# own PATH search: Get-Command caches lookups per session
function Test-Tool([string]$Name) {
  foreach ($d in ($env:PATH -split [System.IO.Path]::PathSeparator)) {
    if (-not $d) { continue }
    foreach ($ext in '', '.exe', '.cmd', '.bat') {
      if (Test-Path -LiteralPath (Join-Path $d "$Name$ext") -PathType Leaf) { return $true }
    }
  }
  $false
}

function Get-Lines([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return @() }
  @([System.IO.File]::ReadAllText($Path) -split "\r?\n")
}
function Read-Template([string]$Rel) {
  @(Get-Lines (Join-Path $skillDir $Rel) | Where-Object { $_.Trim() })
}
# appends text to a file (created when missing); the old content stays and ends with a newline
function Add-Text([string]$Path, [string]$Text) {
  $old = if (Test-Path -LiteralPath $Path -PathType Leaf) { [System.IO.File]::ReadAllText($Path) } else { '' }
  if ($old -and -not $old.EndsWith("`n")) { $old += "`n" }
  [System.IO.File]::WriteAllText($Path, $old + $Text, $utf8)
}

# ---- .gitattributes ---------------------------------------------------------------------------------------------------
function Get-AttributesPlan {
  $path = Join-Path $root '.gitattributes'
  $want = Read-Template 'templates/gitattributes'
  $have = @(Get-Lines $path | ForEach-Object { $_.Trim() })
  $missing = @($want | Where-Object { $have -notcontains $_ })
  $action = if (-not (Test-Path -LiteralPath $path)) { 'create' } elseif ($missing.Count) { 'append' } else { 'unchanged' }
  [ordered]@{ action = $action; missing = $missing }
}
function Write-Attributes($plan) {
  if ($plan.action -eq 'unchanged') { return 'unchanged' }
  Add-Text (Join-Path $root '.gitattributes') (($plan.missing -join "`n") + "`n")
  if ($plan.action -eq 'create') { 'created' } else { 'appended' }
}

# ---- .gitignore -------------------------------------------------------------------------------------------------------
function Get-IgnorePlan([string[]]$Keys) {
  $path = Join-Path $root '.gitignore'
  $have = [System.Collections.Generic.HashSet[string]]::new([string[]]@(Get-Lines $path | ForEach-Object { $_.Trim() }))
  $sections = [System.Collections.Generic.List[object]]::new()
  foreach ($t in @($Keys | ForEach-Object { if ($_ -eq 'ng') { 'ts' } else { $_ } } | Select-Object -Unique)) {
    $new = @(Read-Template "templates/gitignore/$t.gitignore" | Where-Object { $have.Add($_) })
    if ($new.Count) { $sections.Add([ordered]@{ language = $t; add = $new }) }
  }
  $action = 'unchanged'
  if ($sections.Count) { $action = if (Test-Path -LiteralPath $path) { 'append' } else { 'create' } }
  [ordered]@{ action = $action; sections = @($sections) }
}
function Write-Ignore($plan) {
  if ($plan.action -eq 'unchanged') { return 'unchanged' }
  $blocks = @($plan.sections | ForEach-Object { "# $($_.language) (project-setup)`n" + ($_.add -join "`n") + "`n" })
  $text = $blocks -join "`n"
  $path = Join-Path $root '.gitignore'
  if ($plan.action -eq 'append') { $text = "`n$text" }
  Add-Text $path $text
  if ($plan.action -eq 'create') { 'created' } else { 'appended' }
}

# ---- hook -------------------------------------------------------------------------------------------------------------
function Get-HookPlan([string[]]$Keys) {
  if (-not $Keys.Count) { return [ordered]@{ action = 'none'; tool = $null; skill = $null; warnings = @() } }
  $husky = Test-Path -LiteralPath (Join-Path $root '.husky')
  $lefthook = Test-Path -LiteralPath (Join-Path $root 'lefthook.yml')
  if ($husky -or $lefthook) {
    $what = if ($husky) { '.husky/' } else { 'lefthook.yml' }
    return [ordered]@{ action = 'exists'; tool = $(if ($husky) { 'husky' } else { 'lefthook' }); skill = $null; warnings = @("$what exists, left unchanged") }
  }
  $pureTs = @($Keys | Where-Object { @('ts', 'ng') -notcontains $_ }).Count -eq 0
  if ($pureTs) {
    $prettier = @(Get-ChildItem -LiteralPath $root -Force -File -ErrorAction SilentlyContinue | Where-Object { $_.Name -like '.prettierrc*' -or $_.Name -like 'prettier.config.*' }).Count -gt 0
    $skill = if (($Keys -contains 'ng') -or $prettier) { 'setup-prettier-eslint-husky' } else { 'setup-biome-husky' }
    return [ordered]@{ action = 'delegate'; tool = 'husky'; skill = $skill; warnings = @() }
  }
  $warnings = @()
  if (-not (Test-Tool 'lefthook')) {
    $warnings = @('lefthook not found: brew install lefthook | winget install evilmartians.lefthook | npm i -D lefthook (not installed by project-setup)')
  }
  $dir = $ImplementationDir.TrimEnd('/', '\').Replace('\', '/')
  $cmds = @($Keys | ForEach-Object {
      "    format-${_}:`n      run: pwsh $dir/scripts/Format-Changed.ps1 -Language $_ -Check"
    }) -join "`n"
  $template = [System.IO.File]::ReadAllText((Join-Path $skillDir 'templates/lefthook.yml'))
  [ordered]@{ action = 'create'; tool = 'lefthook'; skill = $null; languages = $Keys; content = $template.Replace('    # {{commands}}', $cmds); warnings = $warnings }
}
function Write-Hook($plan) {
  switch ($plan.action) {
    'create' { [System.IO.File]::WriteAllText((Join-Path $root 'lefthook.yml'), $plan.content, $utf8); 'created' }
    'delegate' { "delegated: run the skill $($plan.skill)" }
    default { $plan.action }
  }
}

# ---- run --------------------------------------------------------------------------------------------------------------
$keys = Get-Stack
$attr = Get-AttributesPlan
$ignore = Get-IgnorePlan $keys
$hook = Get-HookPlan $keys
$result = [ordered]@{ applied = [bool]$Apply; languages = $keys; gitattributes = $attr; gitignore = $ignore; hook = $hook }
if ($Apply) {
  $result.gitattributes.result = Write-Attributes $attr
  $result.gitignore.result = Write-Ignore $ignore
  $result.hook.result = Write-Hook $hook
}
$result | ConvertTo-Json -Depth 8
