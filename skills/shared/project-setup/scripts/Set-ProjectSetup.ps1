<#
.SYNOPSIS
  Plans (default, dry run) or applies the project setup: the `format` key of .agents/config.json per language and the .editorconfig.
.DESCRIPTION
  Runs detect-techstack, maps its languages to the keys of `format` (ts, ng, py, dotnet, rust, go) and prints the plan as JSON:
  per language the default formatter, the detected tool, the options and the choice; the .editorconfig action; tool checks.
  Without -Apply nothing is written. With -Apply only non-default choices are written under `format` (other keys of the file stay,
  an existing entry of a language stays unless it gets a new non-default choice); an existing .editorconfig is never overwritten
  (the action is `exists` with a diff). A missing tool is reported with its install hint, never installed.
  Extension points: one Get-*Plan function and one Apply-* function per part (format, editorconfig).
.PARAMETER ProjectRoot
  Project root (default: current directory).
.PARAMETER Choice
  `lang=option` entries, e.g. 'dotnet=jb','ts=biome','py=custom'. `default` (or no entry) keeps the default.
  Options per language are listed in the plan (`options`).
.PARAMETER FormatCommand
  `lang=command` for a `custom` choice (the format command, {files} placeholder).
.PARAMETER CheckCommand
  `lang=command` for a `custom` choice (the read-only check command). Required for `custom`.
.PARAMETER StackJson
  A `detect-techstack` report (JSON text) instead of running the detection; for tests and callers that already have the report.
.PARAMETER Apply
  Write the changes. Without it the script is a dry run.
#>
[CmdletBinding()]
param(
  [string]$ProjectRoot = '.',
  [string[]]$Choice = @(),
  [string[]]$FormatCommand = @(),
  [string[]]$CheckCommand = @(),
  [string]$StackJson,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail([string]$Message) {
  Write-Error "Set-ProjectSetup: $Message" -ErrorAction Continue
  exit 1
}

$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$skillDir = Split-Path -Parent $PSScriptRoot
$utf8 = [System.Text.UTF8Encoding]::new($false)

function ConvertTo-Map([string[]]$Pairs, [string]$What) {
  $map = @{}
  foreach ($p in $Pairs) {
    $i = $p.IndexOf('=')
    if ($i -lt 1) { Fail "$What '$p' is not <lang>=<value>" }
    $map[$p.Substring(0, $i).Trim()] = $p.Substring($i + 1).Trim()
  }
  $map
}

# ---- stack ------------------------------------------------------------------------------------------------------------
function Get-Stack {
  if ($StackJson) { $json = $StackJson } else {
  $detect = @(
    (Join-Path $skillDir '../detect-techstack/scripts/Detect-TechStack.ps1')
    (Join-Path $skillDir '../../shared/detect-techstack/scripts/Detect-TechStack.ps1')
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $detect) { Fail 'detect-techstack not found next to project-setup; run /skills-manage shared' }
  # in-process: `exit` inside the called script ends only that script
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
  [pscustomobject]@{ Keys = @($keys); Tools = @($report.tools) }
}

# ---- tools ------------------------------------------------------------------------------------------------------------
# own PATH search: Get-Command caches lookups per session, a stale hit would hide a PATH change
function Test-Tool([string]$Name) {
  foreach ($d in ($env:PATH -split [System.IO.Path]::PathSeparator)) {
    if (-not $d) { continue }
    foreach ($ext in '', '.exe', '.cmd', '.bat') {
      if (Test-Path -LiteralPath (Join-Path $d "$Name$ext") -PathType Leaf) { return $true }
    }
  }
  $false
}
function Get-ToolStatus([string]$Name, [string]$Hint, [bool]$Needed) {
  [ordered]@{ name = $Name; found = (Test-Tool $Name); installHint = $Hint; needed = $Needed }
}
$jbHint = 'dotnet tool install -g JetBrains.ReSharper.GlobalTools'

# ---- format plan ------------------------------------------------------------------------------------------------------
$webExt = @('.ts', '.tsx', '.js', '.mjs', '.cjs')
$biomeFmt = 'npx biome check --write --no-errors-on-unmatched {files}'
$biomeChk = 'npx biome check --no-errors-on-unmatched {files}'
$defaultExt = @{
  ts = $webExt + '.jsx'; ng = $webExt; py = @('.py', '.pyi'); dotnet = @('.cs'); rust = @('.rs'); go = @('.go')
}

function Find-Solution {
  foreach ($pat in '*.slnx', '*.sln') {
    $f = Get-ChildItem -LiteralPath $root -Filter $pat -File -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($f) { return $f.Name }
  }
  $null
}

function Get-DetectedTool([string]$Lang, [string[]]$Tools) {
  switch ($Lang) {
    { $_ -in 'ts', 'ng' } {
      $t = @($Tools | Where-Object { $_ -in 'biome', 'prettier', 'eslint' })
      if ($t.Count) { return ($t -join '+') } else { return $null }
    }
    'py' {
      $ruff = (Test-Path -LiteralPath (Join-Path $root 'ruff.toml')) -or (Test-Path -LiteralPath (Join-Path $root '.ruff.toml')) -or
      ((Test-Path -LiteralPath (Join-Path $root 'pyproject.toml')) -and ((Get-Content -LiteralPath (Join-Path $root 'pyproject.toml') -Raw) -match '(?m)^\[tool\.ruff'))
      if ($ruff) { return 'ruff' } else { return $null }
    }
    'dotnet' { if (Test-Tool 'jb') { return 'jb' } else { return $null } }
    default { return $null }
  }
}

# option table: id -> entry (null = the default of the language, nothing is written)
function Get-FormatOptions([string]$Lang, [string[]]$Tools) {
  $opts = [ordered]@{}
  switch ($Lang) {
    { $_ -in 'ts', 'ng' } {
      $eslintExt = $defaultExt[$Lang]
      $pe = [ordered]@{
        extensions = @($eslintExt)
        format     = @('npx --no-install prettier --write {files}', 'npx --no-install eslint --fix {files}')
        check      = @('npx --no-install prettier --check {files}', 'npx --no-install eslint {files}')
      }
      $bio = [ordered]@{ extensions = @($defaultExt[$Lang] + @('.json', '.css', '.html', '.md', '.yml', '.yaml')); format = $biomeFmt; check = $biomeChk }
      $biomeDefault = $Tools -contains 'biome'
      $opts['prettier-eslint'] = if ($biomeDefault) { $pe } else { $null }
      $opts['biome'] = if ($biomeDefault) { $null } else { $bio }
      $defaultId = if ($biomeDefault) { 'biome' } else { 'prettier-eslint' }
    }
    'py' { $opts['ruff'] = $null; $defaultId = 'ruff' }
    'dotnet' {
      $opts['dotnet-format'] = $null
      $sln = Find-Solution
      # cleanupcode has no read-only mode (jb cleanupcode --help): the check stays dotnet format --verify-no-changes
      $opts['jb'] = [ordered]@{
        extensions = @('.cs')
        format     = "jb cleanupcode --include={files} $(if ($sln) { $sln } else { '<solution>' })"
        check      = 'dotnet format --verify-no-changes --include {files}'
        needsSolution = (-not $sln)
      }
      $defaultId = 'dotnet-format'
    }
    'rust' { $opts['cargo-fmt'] = $null; $defaultId = 'cargo-fmt' }
    'go' { $opts['gofmt'] = $null; $defaultId = 'gofmt' }
  }
  $opts['custom'] = 'custom'
  [pscustomobject]@{ Options = $opts; DefaultId = $defaultId }
}

function Get-FormatPlan($Stack, $Choices, $Formats, $Checks) {
  $entries = [System.Collections.Generic.List[object]]::new()
  foreach ($lang in $Stack.Keys) {
    $o = Get-FormatOptions $lang $Stack.Tools
    $want = if ($Choices.ContainsKey($lang)) { $Choices[$lang] } else { 'default' }
    if ($want -eq 'default') { $want = $o.DefaultId }
    if (-not $o.Options.Contains($want)) { Fail "unknown option '$want' for $lang (options: $($o.Options.Keys -join ', '))" }
    $entry = $null
    if ($want -eq 'custom') {
      if (-not $Formats.ContainsKey($lang) -or -not $Checks.ContainsKey($lang)) { Fail "custom for $lang needs -FormatCommand '$lang=<cmd>' and -CheckCommand '$lang=<cmd>'" }
      $entry = [ordered]@{ extensions = @($defaultExt[$lang]); format = $Formats[$lang]; check = $Checks[$lang] }
    }
    elseif ($null -ne $o.Options[$want]) {
      $entry = [ordered]@{} + $o.Options[$want]
      if ($entry.Contains('needsSolution')) {
        if ($entry['needsSolution']) { Fail 'jb needs a solution file (*.slnx or *.sln) in the project root' }
        $entry.Remove('needsSolution')
      }
    }
    $tools = @()
    if ($lang -eq 'dotnet') { $tools += , (Get-ToolStatus 'jb' $jbHint ($want -eq 'jb')) }
    if ($want -eq 'custom') {
      $first = ($Formats[$lang] -split '\s+')[0]
      $tools += , (Get-ToolStatus $first $null $true)
    }
    $entries.Add([ordered]@{
        language = $lang
        default  = $o.DefaultId
        detected = Get-DetectedTool $lang $Stack.Tools
        options  = @($o.Options.Keys)
        choice   = $want
        write    = ($null -ne $entry)
        entry    = $entry
        tools    = $tools
      })
  }
  , $entries.ToArray()
}

function Get-ConfigPath { Join-Path $root '.agents/config.json' }

function Read-Config {
  $path = Get-ConfigPath
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  try { Get-Content -LiteralPath $path -Raw | ConvertFrom-Json -ErrorAction Stop }
  catch { Fail ".agents/config.json is not valid JSON: $($_.Exception.Message)" }
}

function Test-FormatEntry($Entry, [string]$Lang) {
  $cmd = { param($v) ($v -is [string] -and $v) -or ($v -is [array] -and $v.Count -ge 1 -and -not ($v | Where-Object { -not ($_ -is [string] -and $_) })) }
  if (-not (& $cmd $Entry['format'])) { Fail "format.$Lang has no valid format command" }
  if ($Entry.Contains('check') -and -not (& $cmd $Entry['check'])) { Fail "format.$Lang has no valid check command" }
  foreach ($k in $Entry.Keys) { if ($k -notin 'extensions', 'format', 'check') { Fail "format.$Lang has unknown key $k" } }
}

function Apply-FormatPlan($Plan) {
  $todo = @($Plan | Where-Object { $_.write })
  if (-not $todo.Count) { return 'unchanged' }
  $cfg = Read-Config
  if ($null -eq $cfg) { $cfg = [pscustomobject]@{ '$schema' = 'https://raw.githubusercontent.com/GravionLabs/skills/main/skills/shared/implementation/schema/config.schema.json' } }
  $hasFormat = $cfg.PSObject.Properties.Name -contains 'format'
  if ($hasFormat -and $cfg.format -is [bool] -and -not $cfg.format) { return 'skipped: format is false (disabled) in .agents/config.json' }
  if ($hasFormat -and $null -ne $cfg.format -and $cfg.format.GetType().Name -ne 'PSCustomObject') { Fail 'format in .agents/config.json is neither false nor a map' }
  if (-not $hasFormat) { $cfg | Add-Member -NotePropertyName format -NotePropertyValue ([pscustomobject]@{}) }
  foreach ($p in $todo) {
    Test-FormatEntry $p.entry $p.language
    $e = [ordered]@{}
    foreach ($k in $p.entry.Keys) {
      $v = $p.entry[$k]
      if ($v -is [array] -and $k -ne 'extensions' -and $v.Count -eq 1) { $e[$k] = $v[0] } else { $e[$k] = $v }
    }
    $cfg.format | Add-Member -NotePropertyName $p.language -NotePropertyValue ([pscustomobject]$e) -Force
  }
  $path = Get-ConfigPath
  New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
  [System.IO.File]::WriteAllText($path, (($cfg | ConvertTo-Json -Depth 10) + "`n"), $utf8)
  'written'
}

# ---- .editorconfig -----------------------------------------------------------------------------------------------------
function Get-EditorconfigText($Stack) {
  $t = Join-Path $skillDir 'templates'
  $read = { param($f) (Get-Content -LiteralPath (Join-Path $t $f) -Raw) -replace "`r`n", "`n" }
  $text = if ($Stack.Keys -contains 'dotnet') { & $read 'dotnet.editorconfig' } else { & $read 'base.editorconfig' }
  $done = @()
  foreach ($k in $Stack.Keys) {
    $sec = switch ($k) { 'ng' { 'ts' } { $_ -in 'py', 'rust', 'go', 'ts' } { $_ } default { $null } }
    if ($sec -and $sec -notin $done) { $done += $sec; $text = $text.TrimEnd("`n") + "`n" + (& $read "sections/$sec.editorconfig") }
  }
  $text
}

function Get-EditorconfigPlan($Stack) {
  $path = Join-Path $root '.editorconfig'
  $text = Get-EditorconfigText $Stack
  $plan = [ordered]@{ path = '.editorconfig'; action = 'create'; diff = $null }
  if (Test-Path -LiteralPath $path -PathType Leaf) {
    $current = (Get-Content -LiteralPath $path -Raw) -replace "`r`n", "`n"
    if ($current -eq $text) { $plan.action = 'unchanged'; return $plan }
    $plan.action = 'exists'
    $tmp = [System.IO.Path]::GetTempFileName()
    try {
      [System.IO.File]::WriteAllText($tmp, $text, $utf8)
      $plan.diff = ((& git diff --no-index --no-color -- $path $tmp 2>&1) | Out-String).TrimEnd()
    }
    finally { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
  }
  $plan
}

function Apply-Editorconfig($Plan, [string]$Text) {
  if ($Plan.action -ne 'create') { return $Plan.action }
  $path = Join-Path $root '.editorconfig'
  # never overwrite: -NoClobber semantics even if the file appeared since the plan
  if (Test-Path -LiteralPath $path) { return 'exists' }
  [System.IO.File]::WriteAllText($path, $Text, $utf8)
  'written'
}

# ---- main -------------------------------------------------------------------------------------------------------------
$choices = ConvertTo-Map $Choice '-Choice'
$formats = ConvertTo-Map $FormatCommand '-FormatCommand'
$checks = ConvertTo-Map $CheckCommand '-CheckCommand'
$stack = Get-Stack
foreach ($k in $choices.Keys) { if ($k -notin $stack.Keys) { Fail "-Choice names '$k', which is not a detected language ($($stack.Keys -join ', '))" } }

$formatPlan = Get-FormatPlan $stack $choices $formats $checks
$ecPlan = Get-EditorconfigPlan $stack
$ecText = Get-EditorconfigText $stack
$result = [ordered]@{ mode = if ($Apply) { 'apply' } else { 'dry-run' }; languages = $formatPlan; editorconfig = $null; format = $null }
if ($Apply) {
  $result.format = Apply-FormatPlan $formatPlan
  $ecPlan.result = Apply-Editorconfig $ecPlan $ecText
}
$result.editorconfig = $ecPlan
$warnings = @()
foreach ($p in $formatPlan) { foreach ($t in $p.tools) { if ($t.needed -and -not $t.found) { $warnings += "$($t.name) not found" + $(if ($t.installHint) { ": $($t.installHint)" }) } } }
$result.warnings = @($warnings | Select-Object -Unique)
$result | ConvertTo-Json -Depth 10
