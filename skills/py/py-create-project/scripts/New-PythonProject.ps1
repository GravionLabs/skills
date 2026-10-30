<#
.SYNOPSIS
  Scaffold a new Python 3.14 project using uv with src layout, ruff, and pytest.

.PARAMETER ProjectName
  Name for the project (used as directory and package name).

.PARAMETER ProjectType
  Project type: 'library' (publishable package), 'app' (application), or
  'workspace' (uv monorepo with libs/ and apps/ subdirectories).

.PARAMETER OutputDirectory
  Parent directory to create the project in. Default: current directory.
#>
param(
  [Parameter(Mandatory)][string]$ProjectName,
  [ValidateSet('library', 'app', 'workspace')][string]$ProjectType = 'app',
  [string]$OutputDirectory = '.',
  [switch]$Upgrade
)

$ErrorActionPreference = 'Stop'
$ScriptDir = $PSScriptRoot
$TemplatesDir = Join-Path $ScriptDir '../templates'
$TargetDir = Join-Path $OutputDirectory $ProjectName

if (-not (Get-Command uv -ErrorAction SilentlyContinue)) {
  Write-Error "uv not found. Install it with: curl -LsSf https://astral.sh/uv/install.sh | sh"
}

if (Test-Path $TargetDir) {
  Write-Error "Directory '$TargetDir' already exists."
}

Write-Host "Scaffolding Python project: $ProjectName ($ProjectType)" -ForegroundColor Cyan

# Derive safe package name (underscores, no hyphens)
$PackageName = $ProjectName.ToLower() -replace '[^a-z0-9]', '_'

if ($ProjectType -eq 'workspace') {
  # Workspace: create root + libs/apps structure
  New-Item -ItemType Directory -Path $TargetDir | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $TargetDir 'libs') | Out-Null
  New-Item -ItemType Directory -Path (Join-Path $TargetDir 'apps') | Out-Null

  # Root pyproject.toml for workspace
  $workspacePkg = Get-Content (Join-Path $TemplatesDir 'pyproject.toml') -Raw
  $workspacePkg = $workspacePkg -replace 'name = "my-project"', "name = `"$($ProjectName.ToLower())-workspace`""
  $workspacePkg += @"

[tool.uv.workspace]
members = ["libs/*", "apps/*"]
"@
  $workspacePkg | Set-Content (Join-Path $TargetDir 'pyproject.toml')
  Copy-Item (Join-Path $TemplatesDir '.python-version') (Join-Path $TargetDir '.python-version')
  Copy-Item (Join-Path $TemplatesDir '.gitignore') (Join-Path $TargetDir '.gitignore')
  Write-Host "Workspace created. Add members with: uv init libs/<lib-name>" -ForegroundColor DarkGray
} else {
  # Standard project: uv init + replace pyproject.toml
  Push-Location $OutputDirectory
  try { uv init $ProjectName --no-readme } finally { Pop-Location }

  # Replace generated pyproject.toml with our template
  $pkg = Get-Content (Join-Path $TemplatesDir 'pyproject.toml') -Raw
  $safePkgName = $ProjectName.ToLower() -replace '[^a-z0-9-]', '-'
  $pkg = $pkg -replace 'name = "my-project"', "name = `"$safePkgName`""
  if ($ProjectType -eq 'app') {
    # App: remove build-system (no publishing)
    $pkg = $pkg -replace '\[build-system\][\s\S]*?(?=\[dependency-groups\])', ''
  }
  $pkg | Set-Content (Join-Path $TargetDir 'pyproject.toml')

  # Create src/<package>/__init__.py
  $srcPkgDir = Join-Path $TargetDir "src/$PackageName"
  New-Item -ItemType Directory -Force -Path $srcPkgDir | Out-Null
  Copy-Item (Join-Path $TemplatesDir 'src/__init__.py') (Join-Path $srcPkgDir '__init__.py') -Force

  # Remove uv-generated hello.py if present
  $helloPath = Join-Path $TargetDir 'src/hello.py'
  if (Test-Path $helloPath) { Remove-Item $helloPath }

  # Create tests/conftest.py
  $testsDir = Join-Path $TargetDir 'tests'
  New-Item -ItemType Directory -Force -Path $testsDir | Out-Null
  Copy-Item (Join-Path $TemplatesDir 'tests/conftest.py') (Join-Path $testsDir 'conftest.py') -Force

  # Overwrite .python-version and .gitignore
  Copy-Item (Join-Path $TemplatesDir '.python-version') (Join-Path $TargetDir '.python-version') -Force
  Copy-Item (Join-Path $TemplatesDir '.gitignore') (Join-Path $TargetDir '.gitignore') -Force

  # Install dev dependencies
  Write-Host "Installing dev dependencies..." -ForegroundColor Cyan
  Push-Location $TargetDir
  try {
    if ($Upgrade) { uv sync --upgrade } else { uv sync }
  } finally { Pop-Location }
}

Write-Host "Done!" -ForegroundColor Green
Write-Host "  uv run ruff check .   -- lint" -ForegroundColor DarkGray
Write-Host "  uv run pytest         -- test" -ForegroundColor DarkGray
Write-Host "Next: add dependencies with 'uv add <package>', then copy templates/.github/workflows/ci.yml for CI" -ForegroundColor DarkGray
