<#
.SYNOPSIS
  Plans (default, dry run) or writes the editor files of a project: for -Editor vscode .vscode/settings.json, extensions.json, tasks.json and launch.json; for -Editor zed .zed/settings.json, tasks.json and debug.json.
.DESCRIPTION
  Prints the plan as JSON. Without -Apply nothing is written. Content comes from templates/vscode/targets.json (commands, shared by all editors), templates/zed/targets.json (Zed formatters) and the mapping in references/launch-targets.md.
  A missing file is created. An existing file is never changed: the plan lists what it lacks (`missing`), the user merges by hand.
  Languages or frameworks without a mapping are skipped with an entry in `notes`.
.PARAMETER ProjectRoot
  Project root (default: current directory).
.PARAMETER Editor
  Editor to write for. `vscode` or `zed` (JetBrains follows with the same mapping).
.PARAMETER StackJson
  A detect-techstack report (JSON text) instead of running the detection.
.PARAMETER Apply
  Write the missing files.
#>
[CmdletBinding()]
param(
  [string]$ProjectRoot = '.',
  [string]$Editor = 'vscode',
  [string]$StackJson,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

function Fail([string]$Message) {
  Write-Error "New-EditorConfig: $Message" -ErrorAction Continue
  exit 1
}
if ($Editor -notin 'vscode', 'zed') { Fail "editor '$Editor' is not supported (vscode, zed)" }

$root = (Resolve-Path -LiteralPath $ProjectRoot).Path
$skillDir = Split-Path -Parent $PSScriptRoot
$utf8 = [System.Text.UTF8Encoding]::new($false)
$map = [System.IO.File]::ReadAllText((Join-Path $skillDir 'templates/vscode/targets.json')) | ConvertFrom-Json -AsHashtable
$zedMap = [System.IO.File]::ReadAllText((Join-Path $skillDir 'templates/zed/targets.json')) | ConvertFrom-Json -AsHashtable
$notes = [System.Collections.Generic.List[string]]::new()

function Get-Report {
  if ($StackJson) { return ($StackJson | Out-String) | ConvertFrom-Json }
  $detect = @(
    (Join-Path $skillDir '../detect-techstack/scripts/Detect-TechStack.ps1')
    (Join-Path $skillDir '../../shared/detect-techstack/scripts/Detect-TechStack.ps1')
  ) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
  if (-not $detect) { Fail 'detect-techstack not found next to project-setup; run /skills-manage shared' }
  $json = & $detect -ProjectRoot $root
  if ($LASTEXITCODE -ne 0) { Fail 'detect-techstack failed' }
  ($json | Out-String) | ConvertFrom-Json
}
function Get-Prop($Obj, [string]$Name) {
  if ($Obj -and $Obj.PSObject.Properties[$Name]) { return $Obj.$Name }
  @()
}
function Read-Jsonc([string]$Path) {
  $t = [System.IO.File]::ReadAllText($Path)
  $t = [regex]::Replace($t, '(?m)^\s*//.*$', '')
  $t = [regex]::Replace($t, '(?s)/\*.*?\*/', '')
  $t = [regex]::Replace($t, ',(\s*[}\]])', '$1')
  $t | ConvertFrom-Json -AsHashtable
}
function Get-SourceFiles([string]$Filter) {
  @(Get-ChildItem -LiteralPath $root -Recurse -Depth 5 -File -Filter $Filter -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -notmatch '[\\/](node_modules|bin|obj|\.git)[\\/]' })
}
function Get-Rel([string]$Full) { [System.IO.Path]::GetRelativePath($root, $Full).Replace('\', '/') }

# ---- stack ------------------------------------------------------------------------------------------------------------
$report = Get-Report
$frameworks = @(Get-Prop $report 'frameworks')
$tools = @(Get-Prop $report 'tools')
$pms = @(Get-Prop $report 'packageManager')
$pm = @('pnpm', 'yarn', 'bun') | Where-Object { $pms -contains $_ } | Select-Object -First 1
if (-not $pm) { $pm = 'npm' }
$keys = [System.Collections.Generic.List[string]]::new()
foreach ($l in @(Get-Prop $report 'languages')) {
  $k = switch ($l) { { $_ -in 'js', 'javascript', 'typescript' } { 'ts' } 'python' { 'py' } 'csharp' { 'dotnet' } default { $l } }
  if ($k -eq 'ts' -and $frameworks -contains 'angular') { $k = 'ng' }
  if (@('ts', 'ng', 'py', 'dotnet', 'rust', 'go') -contains $k) { if (-not $keys.Contains($k)) { $keys.Add($k) } } else { $notes.Add("language '$l' has no launch target, skipped") }
}
foreach ($f in $frameworks) {
  if ($map.frameworksWithoutTarget -contains $f) { $notes.Add("framework '$f' has no start target, only the language targets are written") }
}

# formatter of ts/ng: format key of .agents/config.json, else the detected tool
function Get-TsFormatter([string]$Key) {
  $cfg = Join-Path $root '.agents/config.json'
  if (Test-Path -LiteralPath $cfg) {
    try {
      $c = Read-Jsonc $cfg
      if ($c.ContainsKey('format') -and $c.format -is [System.Collections.IDictionary] -and $c.format.ContainsKey($Key)) {
        $cmd = ($c.format[$Key] | ConvertTo-Json -Depth 5 -Compress)
        if ($cmd -match 'biome') { return 'biome' }
        if ($cmd -match 'prettier') { return 'prettier' }
      }
    } catch { $notes.Add('.agents/config.json is not valid JSON, formatter taken from the detected tools') }
  }
  if ($tools -contains 'biome') { return 'biome' }
  'prettier'
}

# ---- build the content ------------------------------------------------------------------------------------------------
$settings = [ordered]@{ 'editor.formatOnSave' = $true }
$extensions = [System.Collections.Generic.List[string]]::new()
$tasks = [System.Collections.Generic.List[object]]::new()
$configs = [System.Collections.Generic.List[object]]::new()
$zedSettings = [ordered]@{ format_on_save = 'on'; languages = [ordered]@{} }
$zedTasks = [System.Collections.Generic.List[object]]::new()
$zedDebug = [System.Collections.Generic.List[object]]::new()
function Add-Ext([string[]]$Ids) { foreach ($i in $Ids) { if (-not $extensions.Contains($i)) { $extensions.Add($i) } } }

foreach ($k in $keys) {
  $t = $map[$k]
  $formatter = $t.formatter
  Add-Ext @($t.extensions)
  if ($k -in 'ts', 'ng') {
    $which = Get-TsFormatter $k
    $formatter = $map.formatters[$which][0]
    Add-Ext @($map.formatters[$which])
    if ($tools -contains 'vitest') { Add-Ext @('vitest.explorer') }
  }
  $z = $zedMap[$k]
  $zf = if ($k -in 'ts', 'ng') { $zedMap.formatters[$which] } else { $z.formatter }
  $zl = if ($z.ContainsKey('languages')) { $z.languages } else { @($z.language) }
  foreach ($l in $zl) { $zedSettings.languages[$l] = [ordered]@{ formatter = $zf } }
  foreach ($id in $t.languageIds) { $settings["[$id]"] = [ordered]@{ 'editor.defaultFormatter' = $formatter } }
  foreach ($kind in 'build', 'test') {
    if (-not $t[$kind]) { continue }
    $tasks.Add([ordered]@{ label = "${kind}: $k"; type = 'shell'; command = $t[$kind].Replace('{pm}', $pm); group = $kind; problemMatcher = @() })
    $zedTasks.Add([ordered]@{ label = "${kind}: $k"; command = $t[$kind].Replace('{pm}', $pm); use_new_terminal = $false; reveal = 'always' })
  }
  switch ($k) {
    'dotnet' {
      if ($Editor -eq 'zed') { $notes.Add('dotnet: Zed has no built-in .NET debug adapter, no debug entry') }
      $aspire = $frameworks -contains 'aspire'
      $proj = $null
      foreach ($p in Get-SourceFiles '*.csproj') {
        $text = [System.IO.File]::ReadAllText($p.FullName)
        if ($aspire -and $text -match 'Aspire\.AppHost\.Sdk') { $proj = $p; break }
        if (-not $aspire -and -not $proj -and $text -match '<OutputType>Exe|Sdk="Microsoft\.NET\.Sdk\.Web"') { $proj = $p }
      }
      if ($proj) {
        $label = if ($aspire) { 'Debug Aspire AppHost' } else { 'Debug dotnet' }
        $configs.Add([ordered]@{ name = "$label ($($proj.BaseName))"; type = 'dotnet'; request = 'launch'; projectPath = '${workspaceFolder}/' + (Get-Rel $proj.FullName) })
      } else { $notes.Add('dotnet: no startable project found (executable or Aspire AppHost), no launch configuration') }
    }
    { $_ -in 'ts', 'ng' } {
      $pkg = Join-Path $root 'package.json'
      $scripts = @{}
      if (Test-Path -LiteralPath $pkg) {
        try { $j = Read-Jsonc $pkg; if ($j.ContainsKey('scripts')) { $scripts = $j.scripts } } catch { $notes.Add('package.json is not valid JSON') }
      }
      $script = @('dev', 'start') | Where-Object { $scripts.ContainsKey($_) } | Select-Object -First 1
      if ($script) {
        $configs.Add([ordered]@{ name = "Debug dev server ($script)"; type = 'node'; request = 'launch'; runtimeExecutable = $pm; runtimeArgs = @('run', $script); console = 'integratedTerminal' })
        $zedDebug.Add([ordered]@{ label = "Debug dev server ($script)"; adapter = 'JavaScript'; type = 'pwa-node'; request = 'launch'; runtimeExecutable = $pm; runtimeArgs = @('run', $script); cwd = '$ZED_WORKTREE_ROOT' })
      } else { $notes.Add("${k}: no dev or start script in package.json at the root, no dev server configuration") }
      if ($tools -contains 'vitest') {
        $configs.Add([ordered]@{ name = 'Debug Vitest'; type = 'node'; request = 'launch'; program = '${workspaceFolder}/node_modules/vitest/vitest.mjs'; args = @('run'); autoAttachChildProcesses = $true; console = 'integratedTerminal'; skipFiles = @('<node_internals>/**') })
        $zedDebug.Add([ordered]@{ label = 'Debug Vitest'; adapter = 'JavaScript'; type = 'pwa-node'; request = 'launch'; program = '$ZED_WORKTREE_ROOT/node_modules/vitest/vitest.mjs'; args = @('run'); cwd = '$ZED_WORKTREE_ROOT' })
      }
    }
    'py' { $configs.Add([ordered]@{ name = 'Debug current Python file'; type = 'debugpy'; request = 'launch'; program = '${file}'; console = 'integratedTerminal' })
      $zedDebug.Add([ordered]@{ label = 'Debug current Python file'; adapter = 'Debugpy'; request = 'launch'; program = '$ZED_FILE' }) }
    'rust' { $configs.Add([ordered]@{ name = 'Debug cargo run'; type = 'lldb'; request = 'launch'; cargo = [ordered]@{ args = @('build') }; args = @(); cwd = '${workspaceFolder}' })
      $zedDebug.Add([ordered]@{ label = 'Debug cargo run'; adapter = 'CodeLLDB'; request = 'launch'; cargo = [ordered]@{ args = @('build') }; cwd = '$ZED_WORKTREE_ROOT' }) }
    'go' { $configs.Add([ordered]@{ name = 'Debug Go'; type = 'go'; request = 'launch'; mode = 'auto'; program = '${workspaceFolder}' })
      $zedDebug.Add([ordered]@{ label = 'Debug Go'; adapter = 'Delve'; request = 'launch'; mode = 'debug'; program = '$ZED_WORKTREE_ROOT' }) }
  }
}

if ($Editor -eq 'zed') {
  $dirName = '.zed'
  $files = [ordered]@{ 'settings.json' = $zedSettings; 'tasks.json' = @($zedTasks); 'debug.json' = @($zedDebug) }
} else {
  $dirName = '.vscode'
  $files = [ordered]@{
  'settings.json'   = $settings
  'extensions.json' = [ordered]@{ recommendations = @($extensions) }
  'tasks.json'      = [ordered]@{ version = '2.0.0'; tasks = @($tasks) }
  'launch.json'     = [ordered]@{ version = '0.2.0'; configurations = @($configs) }
  }
}
# what an existing file lacks: settings keys, extension ids, task labels, configuration names
function Get-Missing([string]$Name, $Content, $Existing) {
  if ($Editor -eq 'zed') {
    if ($Name -eq 'settings.json') { return @($Content.Keys | Where-Object { -not $Existing.ContainsKey($_) }) }
    $have = @($Existing | ForEach-Object { $_.label })
    return @($Content | Where-Object { $have -notcontains $_.label } | ForEach-Object { $_.label })
  }
  switch ($Name) {
    'settings.json' { @($Content.Keys | Where-Object { -not $Existing.ContainsKey($_) }) }
    'extensions.json' { $have = @($Existing['recommendations']); @($Content.recommendations | Where-Object { $have -notcontains $_ }) }
    'tasks.json' { $have = @($Existing['tasks'] | ForEach-Object { $_.label }); @($Content.tasks | Where-Object { $have -notcontains $_.label } | ForEach-Object { $_.label }) }
    'launch.json' { $have = @($Existing['configurations'] | ForEach-Object { $_.name }); @($Content.configurations | Where-Object { $have -notcontains $_.name } | ForEach-Object { $_.name }) }
  }
}

$dir = Join-Path $root $dirName
$out = [ordered]@{}
foreach ($name in $files.Keys) {
  $path = Join-Path $dir $name
  $content = $files[$name]
  $isEmpty = if ($Editor -eq 'zed') { $name -ne 'settings.json' -and $content.Count -eq 0 } else { switch ($name) { 'extensions.json' { $content.recommendations.Count -eq 0 } 'tasks.json' { $content.tasks.Count -eq 0 } 'launch.json' { $content.configurations.Count -eq 0 } default { $false } } }
  if (-not $keys.Count -or $isEmpty) { $out[$name] = [ordered]@{ action = 'skip'; reason = 'nothing to write' }; continue }
  if (Test-Path -LiteralPath $path) {
    $missing = @()
    try { $missing = @(Get-Missing $name $content (Read-Jsonc $path)) } catch { $notes.Add("$dirName/$name is not valid JSON, compare by hand") }
    $out[$name] = [ordered]@{ action = 'exists'; missing = $missing; result = 'unchanged' }
  } else {
    $out[$name] = [ordered]@{ action = 'create'; content = $content }
    if ($Apply) {
      [void](New-Item -ItemType Directory -Force -Path $dir)
      [System.IO.File]::WriteAllText($path, (ConvertTo-Json -InputObject $content -Depth 10) + "`n", $utf8)
      $out[$name].result = 'created'
    }
  }
}
[ordered]@{ applied = [bool]$Apply; editor = $Editor; languages = @($keys); files = $out; notes = @($notes) } | ConvertTo-Json -Depth 12
