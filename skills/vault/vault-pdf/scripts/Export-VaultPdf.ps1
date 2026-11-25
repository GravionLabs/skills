#Requires -Version 7
<#
.SYNOPSIS
Writes notes of a vault as PDF: Nixe renders each note as HTML, a headless Chromium browser prints it.
.DESCRIPTION
Bridge until Nixe writes PDFs itself (GravionLabs/nixe#598). Windows, macOS and Linux.
Needs the `nixe` command and Google Chrome, Chromium or Microsoft Edge.
A folder is searched recursively; the folders of the roles inbox, templates and attachments, the sources
folder inside each topic (`.nixe/config.json`, English defaults) and hidden folders are skipped. Each PDF is written next to its
note (same name, .pdf) or into -OutDir (flat, by note name). Prints one line per PDF: the vault-relative
path, or the full path outside the vault.
.PARAMETER Path
A note (.md) or a folder, absolute or relative to the vault.
.PARAMETER Vault
Vault root; default is the current directory.
.PARAMETER Filter
File name patterns of the notes to print in a folder; default all notes (*.md).
.PARAMETER Exclude
More folders to skip: an entry with a slash is a vault-relative path, one without is a folder name at any depth.
.PARAMETER OutDir
Folder for the PDFs instead of next to each note.
.PARAMETER Browser
Path of the browser; default $env:PDF_BROWSER, then a search for Chrome, Chromium and Edge.
.PARAMETER Nixe
The nixe command; default $env:NIXE, then `nixe`.
.EXAMPLE
pwsh scripts/Export-VaultPdf.ps1 -Vault ~/vault -Path "Fächer/Geschichte" -Filter '* – Zusammenfassung.md','* – Zeitstrahl.md'
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)][string]$Path,
  [string]$Vault = '.',
  [string[]]$Filter = @('*.md'),
  [string[]]$Exclude = @(),
  [string]$OutDir,
  [string]$Browser = $env:PDF_BROWSER,
  [string]$Nixe = $(if ($env:NIXE) { $env:NIXE } else { 'nixe' }),
  [int]$TimeoutSec = 30
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $Vault).Path
$target = if ([IO.Path]::IsPathRooted($Path)) { $Path } else { Join-Path $root $Path }
if (-not (Test-Path -LiteralPath $target)) { throw "Not found: $Path" }
$target = (Resolve-Path -LiteralPath $target).Path

function Find-Browser {
  $candidates = if ($IsWindows) {
    foreach ($base in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA) | Where-Object { $_ }) {
      Join-Path $base 'Google\Chrome\Application\chrome.exe'
      Join-Path $base 'Microsoft\Edge\Application\msedge.exe'
      Join-Path $base 'Chromium\Application\chrome.exe'
    }
  } elseif ($IsMacOS) {
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
    '/Applications/Chromium.app/Contents/MacOS/Chromium'
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
  } else {
    foreach ($name in 'google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge') {
      (Get-Command $name -ErrorAction Ignore).Source
    }
  }
  $candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}

# What a folder export never prints, from the roles of .nixe/config.json (English defaults) and -Exclude:
# Paths: the vault-relative folders of inbox, templates, attachments and every -Exclude entry with a slash.
# Names: the sources folder inside each topic and every -Exclude entry without a slash, at any depth.
function Get-Skip {
  $roles = @{ inbox = 'Inbox'; templates = 'Templates'; attachments = 'Attachments'; sources = 'Sources' }
  $cfgFile = Join-Path $root '.nixe/config.json'
  if (Test-Path -LiteralPath $cfgFile) {
    $cfg = Get-Content -LiteralPath $cfgFile -Raw | ConvertFrom-Json -AsHashtable
    if ($cfg.folders) {
      foreach ($k in @($roles.Keys)) {
        $v = $cfg.folders[$k]
        if ($v -is [string]) { $roles[$k] = $v } elseif ($v -and $v.path) { $roles[$k] = [string]$v.path }
      }
    }
  }
  $paths = @($roles.inbox, $roles.templates, $roles.attachments) + @($Exclude | Where-Object { $_ -match '[\\/]' })
  @{
    Paths = @($paths | ForEach-Object { [IO.Path]::GetFullPath((Join-Path $root $_)).TrimEnd('/', '\') })
    Names = @(@(Split-Path -Leaf $roles.sources) + @($Exclude | Where-Object { $_ -notmatch '[\\/]' }))
  }
}

# Warns when a Mermaid timeline is scaled to the page width below a readable label size (GravionLabs/nixe#597).
function Test-TimelineFit([string]$Html, [string]$Note) {
  $text = Get-Content -LiteralPath $Html -Raw
  $pageMm = @{ A3 = 297.0; A4 = 210.0; A5 = 148.0; Letter = 215.9; Legal = 215.9 }
  $page = [regex]::Match($text, '@page\s*\{\s*size:\s*(\w+)[^}]*?margin:\s*([\d.]+)mm')
  $widthMm = if ($page.Success -and $pageMm[$page.Groups[1].Value]) { $pageMm[$page.Groups[1].Value] } else { 210.0 }
  $marginMm = if ($page.Success) { [double]$page.Groups[2].Value } else { 18.0 }
  $contentPx = ($widthMm - 2 * $marginMm) / 25.4 * 96
  $svg = '<svg[^>]*viewBox="[-\d.]+ [-\d.]+ ([\d.]+) [\d.]+"[^>]*aria-roledescription="timeline"'
  foreach ($m in [regex]::Matches($text, $svg)) {
    $scale = [math]::Min(1.0, $contentPx / [double]$m.Groups[1].Value)
    $labelPx = [math]::Round(16 * $scale, 1)
    if ($labelPx -lt 9) {
      Write-Warning ("${Note}: timeline too wide for the page, labels print at about $labelPx px " +
        "(scale $([math]::Round($scale * 100)) %); use a table or shorter timeline blocks (GravionLabs/nixe#597).")
    }
  }
}

if (-not $Browser) { $Browser = Find-Browser }
if (-not $Browser) { throw 'No Chrome, Chromium or Edge found; pass -Browser or set PDF_BROWSER.' }
if (-not (Get-Command $Nixe -ErrorAction Ignore)) { throw "nixe not found ('$Nixe'); pass -Nixe or set NIXE." }

$notes = if (Test-Path -LiteralPath $target -PathType Leaf) {
  @(Get-Item -LiteralPath $target)
} else {
  $skip = Get-Skip
  # `pwsh -File` passes 'a','b' as one string "a,b": split the patterns on commas
  $patterns = @($Filter | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
  @(Get-ChildItem -LiteralPath $target -Recurse -File -Filter '*.md' | Where-Object {
      $f = $_.FullName
      $dirs = @([IO.Path]::GetRelativePath($root, $f) -split '[\\/]' | Select-Object -SkipLast 1)
      $hidden = $dirs | Where-Object { $_.StartsWith('.') }
      $named = $dirs | Where-Object { $skip.Names -contains $_ }
      $inPath = $skip.Paths | Where-Object { $f.StartsWith($_ + [IO.Path]::DirectorySeparatorChar) }
      $name = $_.Name
      -not $hidden -and -not $named -and -not $inPath -and ($patterns | Where-Object { $name -like $_ })
    } | Sort-Object FullName)
}
if ($notes.Count -eq 0) { Write-Warning "No matching notes under $Path."; return }
if ($OutDir) {
  $out = if ([IO.Path]::IsPathRooted($OutDir)) { $OutDir } else { Join-Path $root $OutDir }
  $OutDir = (New-Item -ItemType Directory -Force -Path $out).FullName
}

$tmp = Join-Path ([IO.Path]::GetTempPath()) "vault-pdf-$PID"
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
try {
  foreach ($note in $notes) {
    # Vault-relative path with .md: unique even when two notes share a name
    $rel = [IO.Path]::GetRelativePath($root, $note.FullName) -replace '\\', '/'
    $html = Join-Path $tmp ($note.BaseName + '.html')
    $pdf = if ($OutDir) { Join-Path $OutDir ($note.BaseName + '.pdf') } else { [IO.Path]::ChangeExtension($note.FullName, '.pdf') }

    Remove-Item -LiteralPath $html -ErrorAction Ignore
    & $Nixe export $rel --format html --out $html --vault $root
    if ($LASTEXITCODE -ne 0) { throw "nixe export failed (exit $LASTEXITCODE): $rel" }
    # A running Nixe exports in its window and the command returns at once (GravionLabs/nixe#596):
    # wait until the file exists and its size stops changing.
    $size = -1; $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ($true) {
      $now = if (Test-Path -LiteralPath $html) { (Get-Item -LiteralPath $html).Length } else { -1 }
      if ($now -gt 0 -and $now -eq $size) { break }
      if ((Get-Date) -gt $deadline) { throw "nixe export wrote no file within $TimeoutSec s: $rel" }
      $size = $now; Start-Sleep -Milliseconds 250
    }
    Test-TimelineFit -Html $html -Note $rel

    # Own profile so a running browser does not take the job; --headless=new returns after the PDF is written
    $browserArgs = @(
      '--headless=new', '--disable-gpu', '--no-pdf-header-footer', '--no-first-run',
      "--user-data-dir=$(Join-Path $tmp 'profile')", "--print-to-pdf=$pdf",
      [Uri]::new($html, [UriKind]::Absolute).AbsoluteUri
    )
    Remove-Item -LiteralPath $pdf -ErrorAction Ignore
    & $Browser @browserArgs 2>$null | Out-Null
    if (-not (Test-Path -LiteralPath $pdf)) { throw "Printing failed: $rel" }
    $shown = [IO.Path]::GetRelativePath($root, $pdf)
    if ($shown.StartsWith('..')) { $shown = $pdf }
    $shown -replace '\\', '/'
  }
} finally {
  Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction Ignore
}
