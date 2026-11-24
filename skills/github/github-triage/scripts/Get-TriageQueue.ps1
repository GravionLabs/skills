<#
.SYNOPSIS
  Triage queue of issues filed by others, and the triage labels.
.DESCRIPTION
  -Mode list   prints JSON {noLevel, needsTriage, needsInfoReplied}, each oldest first.
  -Mode labels creates the labels needs-triage and needs-info when missing.
  -IssuesFile  reads the issues from a JSON file (gh issue list --json
               number,title,labels,createdAt,author,comments) instead of gh (tests).
  -Existing    names of existing labels instead of gh label list (tests, with -DryRun).
#>
[CmdletBinding()]
param(
  [ValidateSet('list', 'labels')][string]$Mode = 'list',
  [string]$Repo,
  [string]$IssuesFile,
  [string[]]$Existing,
  [switch]$DryRun
)
$ErrorActionPreference = 'Stop'

$marker = "Triage notes"
$levelLabels = 'objective', 'epic', 'feature', 'pbi', 'bug', 'task', 'release-test'
$triageLabels = @(
  [pscustomobject]@{ name = 'needs-triage'; color = 'FBCA04'; description = 'Not yet triaged by the owner' }
  [pscustomobject]@{ name = 'needs-info'; color = 'D876E3'; description = 'Waiting for information from the reporter' }
)
$repoArgs = if ($Repo) { @('--repo', $Repo) } else { @() }

if ($Mode -eq 'labels') {
  if (-not $PSBoundParameters.ContainsKey('Existing')) {
    $Existing = @(gh label list @repoArgs --limit 200 --json name --jq '.[].name')
    if ($LASTEXITCODE -ne 0) { Write-Error 'gh label list failed'; exit 1 }
  }
  $Existing = @($Existing | ForEach-Object { $_ -split ',' })
  $out = foreach ($l in $triageLabels) {
    if ($Existing -contains $l.name) { $state = 'exists' }
    else {
      if (-not $DryRun) {
        gh label create $l.name @repoArgs --color $l.color --description $l.description | Out-Null
        if ($LASTEXITCODE -ne 0) { Write-Error "gh label create $($l.name) failed"; exit 1 }
      }
      $state = 'created'
    }
    [pscustomobject]@{ label = $l.name; state = $state }
  }
  ConvertTo-Json -InputObject @($out) -Compress
  return
}

if ($IssuesFile) { $issues = @(Get-Content -Raw $IssuesFile | ConvertFrom-Json) }
else {
  $json = gh issue list @repoArgs --state open --limit 500 --json number,title,labels,createdAt,author,comments
  if ($LASTEXITCODE -ne 0) { Write-Error 'gh issue list failed'; exit 1 }
  $issues = @($json | ConvertFrom-Json)
}

function Get-Names($issue) { @($issue.labels | ForEach-Object { $_.name }) }
function Format-Issue($i) { [pscustomobject]@{ number = $i.number; title = $i.title; createdAt = $i.createdAt; author = $i.author.login } }
function Test-ReporterReply($i) {
  $comments = @($i.comments)
  $lastNotes = -1
  for ($k = 0; $k -lt $comments.Count; $k++) { if ($comments[$k].body -like "*$marker*" -and $comments[$k].author.login -ne $i.author.login) { $lastNotes = $k } }
  if ($lastNotes -lt 0) { return $false }
  for ($k = $lastNotes + 1; $k -lt $comments.Count; $k++) {
    if ($comments[$k].author.login -eq $i.author.login) { return $true }
  }
  $false
}

$sorted = $issues | Sort-Object createdAt
$noLevel = @(); $needsTriage = @(); $replied = @()
foreach ($i in $sorted) {
  $names = Get-Names $i
  if ($names -contains 'needs-info') { if (Test-ReporterReply $i) { $replied += Format-Issue $i } }
  elseif ($names -contains 'needs-triage') { $needsTriage += Format-Issue $i }
  elseif (-not ($names | Where-Object { $levelLabels -contains $_ })) { $noLevel += Format-Issue $i }
}
[pscustomobject]@{ noLevel = $noLevel; needsTriage = $needsTriage; needsInfoReplied = $replied } | ConvertTo-Json -Depth 5 -Compress
