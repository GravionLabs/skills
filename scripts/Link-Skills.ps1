#Requires -Version 7.0
<#
.SYNOPSIS
    Links the skills of this repository as project skills, so Claude Code and other clients load them instead of global copies.
.DESCRIPTION
    Links every skills/<group>/<name> to .claude/skills/<name> and .agents/skills/<name> (both gitignored). Project skills take
    precedence over global ones (~/.claude/skills), so a deliver run in this repository uses skills/delivery/deliver/.
    An existing link is replaced; a real directory or file of the same name is left alone and reported.
    Symlinks on macOS/Linux, directory junctions on Windows (no admin rights needed).
.PARAMETER Root
    Repository root. Default: the parent of this script's folder.
.PARAMETER Remove
    Removes only the links that point into <Root>/skills; real directories and foreign links stay.
#>
[CmdletBinding()]
param(
    [string]$Root = (Split-Path -Parent $PSScriptRoot),
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$Root = (Resolve-Path -LiteralPath $Root).Path
$skillsDir = Join-Path $Root 'skills'
$targets = @('.claude/skills', '.agents/skills') | ForEach-Object { Join-Path $Root $_ }

function Test-OwnLink([System.IO.FileSystemInfo]$Item) {
    if (-not $Item.LinkType) { return $false }
    $target = [string]($Item.Target | Select-Object -First 1)
    if (-not [System.IO.Path]::IsPathRooted($target)) {
        $target = Join-Path (Split-Path -Parent $Item.FullName) $target
    }
    $full = [System.IO.Path]::GetFullPath($target)
    $prefix = $skillsDir.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
    return $full.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)
}

function Remove-Link([System.IO.FileSystemInfo]$Item) {
    # Delete() removes the link itself, never the target's contents
    $Item.Delete()
}

$linked = 0; $removed = 0; $skipped = 0

if ($Remove) {
    foreach ($dir in $targets) {
        if (-not (Test-Path -LiteralPath $dir)) { continue }
        foreach ($item in Get-ChildItem -LiteralPath $dir -Force) {
            if (Test-OwnLink $item) {
                Remove-Link $item
                $removed++
            }
        }
    }
    Write-Output "removed $removed link(s)"
    exit 0
}

if (-not (Test-Path -LiteralPath $skillsDir)) {
    Write-Error "no skills folder under $Root" -ErrorAction Continue
    exit 2
}

$skills = Get-ChildItem -LiteralPath $skillsDir -Directory |
    ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Directory } |
    Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'SKILL.md') }

foreach ($dir in $targets) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    foreach ($skill in $skills) {
        $link = Join-Path $dir $skill.Name
        $existing = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
        if ($existing) {
            if (-not $existing.LinkType) {
                Write-Output "skipped $link (real directory, not a link)"
                $skipped++
                continue
            }
            Remove-Link $existing
        }
        $type = if ($IsWindows) { 'Junction' } else { 'SymbolicLink' }
        New-Item -ItemType $type -Path $link -Target $skill.FullName | Out-Null
        $linked++
    }
}

Write-Output "linked $linked, skipped $skipped"
