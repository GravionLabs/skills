#Requires -Version 7.0
<#
.SYNOPSIS
    Runs PSScriptAnalyzer with PSScriptAnalyzerSettings.psd1 over the PowerShell files of the repository.
.DESCRIPTION
    Prints file, line and rule of every finding and exits 1 if there is any.
.PARAMETER Root
    Repository root (settings file location and base of the default paths).
.PARAMETER Path
    Paths to analyze recursively, relative to Root. Default: skills, scripts, .github.
#>
[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [string[]]$Path = @('skills', 'scripts', '.github')
)

$ErrorActionPreference = 'Stop'

if (-not (Get-Module -ListAvailable -Name PSScriptAnalyzer)) {
    Write-Error 'PSScriptAnalyzer is not installed: Install-Module PSScriptAnalyzer -Scope CurrentUser'
    exit 2
}

$settings = Join-Path $Root 'PSScriptAnalyzerSettings.psd1'
$findings = foreach ($p in $Path) {
    $full = Join-Path $Root $p
    if (Test-Path $full) {
        Invoke-ScriptAnalyzer -Path $full -Recurse -Settings $settings
    }
}

foreach ($f in $findings) {
    Write-Host ("{0}:{1} [{2}] {3}: {4}" -f $f.ScriptPath, $f.Line, $f.Severity, $f.RuleName, $f.Message)
}

if ($findings) {
    $byRule = $findings | Group-Object RuleName | Sort-Object Count -Descending
    foreach ($g in $byRule) { Write-Host ("{0,5} {1}" -f $g.Count, $g.Name) }
    Write-Host "PSScriptAnalyzer: $(@($findings).Count) finding(s)"
    exit 1
}

Write-Host 'PSScriptAnalyzer: no findings'
exit 0
