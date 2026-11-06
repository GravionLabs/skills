<#
.SYNOPSIS
  Plans (default, dry run) or applies the project setup: the `format` and `lint` keys of .agents/config.json per language, the `governance` key and the .editorconfig.
.DESCRIPTION
  Runs detect-techstack, maps its languages to the keys of `format` (ts, ng, py, dotnet, rust, go) and prints the plan as JSON:
  per language the default formatter, the detected tool, the options and the choice; the .editorconfig action; tool checks.
  Without -Apply nothing is written. With -Apply only non-default choices are written under `format` (other keys of the file stay,
  an existing entry of a language stays unless it gets a new non-default choice); an existing .editorconfig is never overwritten
  (the action is `exists` with a diff). A missing tool is reported with its install hint, never installed.
  Lint works the same way: per language the default linter and the options (`languages[].lint`), only non-default choices are written under `lint`.
  Extension points: one Get-*Plan function and one Write-* function per part (format, lint, editorconfig).
.PARAMETER ProjectRoot
  Project root (default: current directory).
.PARAMETER Choice
  `lang=option` entries, e.g. 'dotnet=jb','ts=biome','py=custom'. `default` (or no entry) keeps the default.
  Options per language are listed in the plan (`options`).
.PARAMETER FormatCommand
  `lang=command` for a `custom` choice (the format command, {files} placeholder).
.PARAMETER CheckCommand
  `lang=command` for a `custom` choice (the read-only check command). Required for `custom`.
.PARAMETER LintChoice
  `lang=option` entries for the linter, e.g. 'dotnet=jb','py=pyright'. `default` (or no entry) keeps the default. Options are listed in the plan (`languages[].lint.options`).
.PARAMETER LintCommand
  `lang=command` for a `custom` lint choice (the lint command, {files} placeholder).
.PARAMETER Governance
  `enable` writes the proposed `governance` key when none exists; `merge` adds the proposal to an existing key (its values stay, lists and specMap are extended);
  `replace` writes the proposal over an existing key. Without it the governance key is only proposed. An existing key is never changed otherwise.
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
  [string[]]$LintChoice = @(),
  [string[]]$LintCommand = @(),
  [ValidateSet('enable', 'merge', 'replace')]
  [string]$Governance,
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
  $gov = if ($report.PSObject.Properties.Name -contains 'governance') { $report.governance } else { $null }
  [pscustomobject]@{ Keys = @($keys); Tools = @($report.tools); Governance = $gov }
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

# ---- lint plan --------------------------------------------------------------------------------------------------------
# option table: id -> entry (null = the default of the language, nothing is written)
function Get-LintOptions([string]$Lang, [string[]]$Tools) {
  $opts = [ordered]@{}
  switch ($Lang) {
    { $_ -in 'ts', 'ng' } {
      $biomeDefault = $Tools -contains 'biome'
      $opts['eslint'] = if ($biomeDefault) { [ordered]@{ extensions = @($defaultExt[$Lang]); command = 'npx --no-install eslint {files}' } } else { $null }
      $opts['biome'] = if ($biomeDefault) { $null } else { [ordered]@{ extensions = @($defaultExt[$Lang]); command = 'npx biome lint --no-errors-on-unmatched {files}' } }
      $opts['oxlint'] = [ordered]@{ extensions = @($defaultExt[$Lang]); command = 'npx oxlint {files}' }
      $defaultId = if ($biomeDefault) { 'biome' } else { 'eslint' }
    }
    'py' {
      $opts['ruff'] = $null
      $opts['pyright'] = [ordered]@{ extensions = @('.py', '.pyi'); command = 'uv run pyright {files}' }
      $opts['mypy'] = [ordered]@{ extensions = @('.py', '.pyi'); command = 'uv run mypy {files}' }
      $defaultId = 'ruff'
    }
    'dotnet' {
      $opts['dotnet-analyzers'] = $null
      $sln = Find-Solution
      # inspectcode writes SARIF; whether it exits non-zero on findings is not verified (references/lint.md of implementation)
      $opts['jb'] = [ordered]@{
        extensions    = @('.cs')
        command       = "jb inspectcode $(if ($sln) { $sln } else { '<solution>' }) --no-build --include={files} -o=obj/inspect.sarif"
        needsSolution = (-not $sln)
      }
      $defaultId = 'dotnet-analyzers'
    }
    'rust' { $opts['clippy'] = $null; $defaultId = 'clippy' }
    'go' { $opts['golangci-lint'] = $null; $defaultId = 'golangci-lint' }
  }
  $opts['custom'] = 'custom'
  [pscustomobject]@{ Options = $opts; DefaultId = $defaultId }
}

function Get-LintPlan([string]$Lang, $Stack, $Choices, $Commands) {
  $o = Get-LintOptions $Lang $Stack.Tools
  $want = if ($Choices.ContainsKey($Lang)) { $Choices[$Lang] } else { 'default' }
  if ($want -eq 'default') { $want = $o.DefaultId }
  if (-not $o.Options.Contains($want)) { Fail "unknown lint option '$want' for $Lang (options: $($o.Options.Keys -join ', '))" }
  $entry = $null
  if ($want -eq 'custom') {
    if (-not $Commands.ContainsKey($Lang)) { Fail "custom lint for $Lang needs -LintCommand '$Lang=<cmd>'" }
    $entry = [ordered]@{ extensions = @($defaultExt[$Lang]); command = $Commands[$Lang] }
  }
  elseif ($null -ne $o.Options[$want]) {
    $entry = [ordered]@{} + $o.Options[$want]
    if ($entry.Contains('needsSolution')) {
      if ($entry['needsSolution']) { Fail 'jb needs a solution file (*.slnx or *.sln) in the project root' }
      $entry.Remove('needsSolution')
    }
  }
  $tools = @()
  if ($want -eq 'jb') { $tools += , (Get-ToolStatus 'jb' $jbHint $true) }
  if ($want -eq 'custom') { $tools += , (Get-ToolStatus (($Commands[$Lang] -split '\s+')[0]) $null $true) }
  [ordered]@{
    default = $o.DefaultId
    options = @($o.Options.Keys)
    choice  = $want
    write   = ($null -ne $entry)
    entry   = $entry
    tools   = $tools
  }
}

function Write-LintPlan($Plan) {
  $todo = @($Plan | Where-Object { $_.lint.write })
  if (-not $todo.Count) { return 'unchanged' }
  $cfg = Read-Config
  if ($null -eq $cfg) { $cfg = [pscustomobject]@{ '$schema' = 'https://raw.githubusercontent.com/GravionLabs/skills/main/skills/shared/implementation/schema/config.schema.json' } }
  $has = $cfg.PSObject.Properties.Name -contains 'lint'
  if ($has -and $cfg.lint -is [bool] -and -not $cfg.lint) { return 'skipped: lint is false (disabled) in .agents/config.json' }
  if ($has -and $null -ne $cfg.lint -and $cfg.lint.GetType().Name -ne 'PSCustomObject') { Fail 'lint in .agents/config.json is neither false nor a map' }
  if (-not $has) { $cfg | Add-Member -NotePropertyName lint -NotePropertyValue ([pscustomobject]@{}) }
  foreach ($p in $todo) {
    $en = $p.lint.entry
    if (-not ($en['command'] -is [string] -and $en['command'])) { Fail "lint.$($p.language) has no valid command" }
    $cfg.lint | Add-Member -NotePropertyName $p.language -NotePropertyValue ([pscustomobject]$en) -Force
  }
  $path = Get-ConfigPath
  New-Item -ItemType Directory -Force -Path (Split-Path $path) | Out-Null
  [System.IO.File]::WriteAllText($path, (($cfg | ConvertTo-Json -Depth 10) + "`n"), $utf8)
  'written'
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

function Write-FormatPlan($Plan) {
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

# ---- governance -------------------------------------------------------------------------------------------------------
function Get-GovValue($Gov, [string]$Name, $Default) {
  if ($Gov -is [pscustomobject] -and $Gov.PSObject.Properties.Name -contains $Name -and $Gov.$Name) { return $Gov.$Name }
  $Default
}

function ConvertTo-Ordered($Object) {
  $m = [ordered]@{}
  if ($Object -is [System.Collections.IDictionary]) { foreach ($k in $Object.Keys) { $m[$k] = $Object[$k] }; return $m }
  foreach ($p in $Object.PSObject.Properties) { $m[$p.Name] = $p.Value }
  $m
}

# proposal from the repo: the ADR and spec folders of detect-techstack; compose, infra and CI paths for adrPaths; one spec per apps/ folder
function Get-GovernanceProposal($Gov) {
  $adrPaths = [System.Collections.Generic.List[string]]::new()
  foreach ($f in 'docker-compose.yml', 'docker-compose.yaml', 'compose.yaml', 'compose.yml') {
    if (Test-Path -LiteralPath (Join-Path $root $f) -PathType Leaf) { $adrPaths.Add($f) }
  }
  if (Test-Path -LiteralPath (Join-Path $root 'infra') -PathType Container) { $adrPaths.Add('infra/**') }
  if (Test-Path -LiteralPath (Join-Path $root '.github/workflows') -PathType Container) { $adrPaths.Add('.github/workflows/**') }
  $specDir = [string](Get-GovValue $Gov 'specDir' 'docs/specs')
  $specMap = [ordered]@{}
  $apps = Join-Path $root 'apps'
  if (Test-Path -LiteralPath $apps -PathType Container) {
    foreach ($d in Get-ChildItem -LiteralPath $apps -Directory | Sort-Object Name) {
      $specMap["apps/$($d.Name)/**"] = "$specDir/$($d.Name).md"
    }
  }
  [ordered]@{
    adrDir     = [string](Get-GovValue $Gov 'adrDir' 'docs/adr')
    adrPaths   = @($adrPaths)
    specDir    = $specDir
    specMap    = $specMap
    specMode   = 'warn'
    skipLabels = @('skip-adr')
  }
}

# the current values stay; the proposal adds what is missing (lists and maps are extended, scalars are kept)
function Merge-Governance($Current, $Proposal) {
  $merged = [ordered]@{}
  foreach ($k in $Current.Keys) { $merged[$k] = $Current[$k] }
  foreach ($k in $Proposal.Keys) {
    $p = $Proposal[$k]
    if (-not $merged.Contains($k)) { $merged[$k] = $p; continue }
    $c = $merged[$k]
    if ($p -is [System.Collections.IDictionary]) {
      $map = ConvertTo-Ordered $c
      foreach ($mk in $p.Keys) { if (-not $map.Contains($mk)) { $map[$mk] = $p[$mk] } }
      $merged[$k] = $map
    }
    elseif ($p -is [array]) {
      $list = [System.Collections.Generic.List[object]]::new()
      foreach ($x in @($c) + @($p)) { if ($null -ne $x -and -not $list.Contains($x)) { $list.Add($x) } }
      $merged[$k] = @($list)
    }
  }
  $merged
}

function Get-GovernanceChanges($Current, $Merged) {
  @($Merged.Keys | Where-Object {
      -not $Current.Contains($_) -or
      ((ConvertTo-Json -InputObject $Current[$_] -Compress -Depth 5) -ne (ConvertTo-Json -InputObject $Merged[$_] -Compress -Depth 5))
    })
}

function Get-GovernancePlan($Stack) {
  $cfg = Read-Config
  $current = $null
  if ($null -ne $cfg -and $cfg.PSObject.Properties.Name -contains 'governance') {
    if ($cfg.governance -isnot [pscustomobject]) { Fail 'governance in .agents/config.json is not a map' }
    $current = ConvertTo-Ordered $cfg.governance
  }
  $proposal = Get-GovernanceProposal $Stack.Governance
  $hint = Get-GovValue $Stack.Governance 'hint' $null
  $merged = if ($null -ne $current) { Merge-Governance $current $proposal } else { $proposal }
  # @() around the call: an empty result would unroll to $null, and .Count would fail under strict mode
  $changed = @()
  if ($null -ne $current) { $changed = @(Get-GovernanceChanges $current $merged) }
  $action = if ($null -eq $current) { 'create' } elseif ($changed.Count) { 'exists' } else { 'unchanged' }
  $entry = $null
  switch ($Governance) {
    'enable' { if ($null -eq $current) { $entry = $proposal } }
    'merge' { if ($null -eq $current) { $entry = $proposal } elseif ($changed.Count) { $entry = $merged } }
    'replace' { if ($null -eq $current -or $changed.Count) { $entry = $proposal } }
  }
  [ordered]@{
    ask         = [bool]$hint
    hint        = $hint
    choice      = if ($Governance) { $Governance } else { 'none' }
    action      = $action
    changedKeys = @($changed)
    write       = ($null -ne $entry)
    entry       = $entry
    current     = $current
    proposal    = $proposal
  }
}

function Write-GovernancePlan($Plan) {
  if ($Plan.choice -eq 'none') { return 'not requested' }
  if (-not $Plan.write) {
    if ($Plan.action -eq 'exists') { return 'skipped: governance exists in .agents/config.json; choose merge or replace' }
    return 'unchanged'
  }
  $cfg = Read-Config
  if ($null -eq $cfg) { $cfg = [pscustomobject]@{ '$schema' = 'https://raw.githubusercontent.com/GravionLabs/skills/main/skills/shared/implementation/schema/config.schema.json' } }
  $cfg | Add-Member -NotePropertyName governance -NotePropertyValue ([pscustomobject]$Plan.entry) -Force
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

function Write-EditorconfigPlan($Plan, [string]$Text) {
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
$lintChoices = ConvertTo-Map $LintChoice '-LintChoice'
$lintCommands = ConvertTo-Map $LintCommand '-LintCommand'
$stack = Get-Stack
foreach ($k in $lintChoices.Keys) { if ($k -notin $stack.Keys) { Fail "-LintChoice names '$k', which is not a detected language ($($stack.Keys -join ', '))" } }
foreach ($k in $choices.Keys) { if ($k -notin $stack.Keys) { Fail "-Choice names '$k', which is not a detected language ($($stack.Keys -join ', '))" } }

$formatPlan = Get-FormatPlan $stack $choices $formats $checks
foreach ($p in $formatPlan) { $p['lint'] = Get-LintPlan $p.language $stack $lintChoices $lintCommands }
$ecPlan = Get-EditorconfigPlan $stack
$ecText = Get-EditorconfigText $stack
$govPlan = Get-GovernancePlan $stack
$result = [ordered]@{ mode = if ($Apply) { 'apply' } else { 'dry-run' }; languages = $formatPlan; editorconfig = $null; format = $null; lint = $null; governance = $null }
if ($Apply) {
  $result.format = Write-FormatPlan $formatPlan
  $result.lint = Write-LintPlan $formatPlan
  $govPlan['result'] = Write-GovernancePlan $govPlan
  $ecPlan.result = Write-EditorconfigPlan $ecPlan $ecText
}
$result.governance = $govPlan
$result.editorconfig = $ecPlan
$warnings = @()
foreach ($p in $formatPlan) { foreach ($t in @($p.tools) + @($p.lint.tools)) { if ($t.needed -and -not $t.found) { $warnings += "$($t.name) not found" + $(if ($t.installHint) { ": $($t.installHint)" }) } } }
$result.warnings = @($warnings | Select-Object -Unique)
$result | ConvertTo-Json -Depth 10
