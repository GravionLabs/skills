<#
.SYNOPSIS
  Status of an [Objective] across repositories: per repo ready, waiting(<reason>) or done, plus the gates (JSON).
.DESCRIPTION
  Read-only: only REST GET calls (`gh api <path>`, lists with --paginate --slurp), no write, no local cache; the result depends
  only on the GitHub state. Builds the graph Objective -> native sub-issues (Features, Epics, also in other repositories of the
  owner) -> recursively down to the PBIs and Bugs. Evaluates the native blocked-by links of the open PBIs and Bugs (a blocker
  keeps its owner/repo) and the `Requires: <owner>/<repo>@<milestone> released|rc` lines (github-issue references/objectives.md)
  of the objective and of every child: `released` = the milestone is closed; `rc` = the `release-test` issue of the milestone
  carries the marker `<!-- release-test-rc -->` (body or comment), a closed milestone counts as met too. A Requires line of the
  objective applies to every repository except the required one; a line of a child applies to the child's repository.
  Per repository: done (it has items, none open), waiting(requires <owner/repo>@<M> <kind>) for an unmet Requires, ready (at
  least one open PBI or Bug without an open blocker, not needs-decision, needs-refinement or release-test), else waiting(<reason>).
  Gates: release-pr (open release PR release/next into the default branch), rc-missing and not-released (unmet Requires, on the
  required repository), acceptance-criteria (unchecked boxes under `## Acceptance Criteria` of the objective).
  JSON per schema/objective-status.schema.json. -Text prints the status block of at most 12 lines instead: the objective, one
  line per repository `<owner/repo>: <closed>/<total> <ready|waiting(<reason>)|done>`, the next ready item (full URL and title)
  and "Needs you" as numbered gates (release PR, RC test, acceptance criteria once all children are closed).
.PARAMETER Objective
  <owner>/<repo>#<nr> of the [Objective] issue.
.PARAMETER Json
  JSON output (the default; accepted for symmetry with the other status scripts).
.PARAMETER Text
  Print the status block (at most 12 lines) instead of JSON.
#>
param(
  [Parameter(Mandatory)][string]$Objective,
  [switch]$Json,
  [switch]$Text
)
$ErrorActionPreference = 'Stop'
function Fail([string]$m) { Write-Error $m -ErrorAction Continue; exit 1 }

if ($Objective -notmatch '^([^/\s#]+)/([^/\s#]+)#([0-9]+)$') { Fail "-Objective must be <owner>/<repo>#<nr>, got '$Objective'" }
$objRepo = "$($Matches[1])/$($Matches[2])"
$objNumber = [int]$Matches[3]

# REST GET only: never -X, -f, -F or --input
function Get-One([string]$path) {
  $raw = & gh api $path 2>$null
  if ($LASTEXITCODE -ne 0) { Fail "gh api $path failed" }
  ($raw | Out-String) | ConvertFrom-Json
}
function Get-Paged([string]$path) {
  $raw = & gh api $path --paginate --slurp 2>$null
  if ($LASTEXITCODE -ne 0) { Fail "gh api $path failed" }
  $items = [System.Collections.Generic.List[object]]::new()
  Add-Leaf $items (($raw | Out-String) | ConvertFrom-Json -NoEnumerate)
  $items.ToArray()
}
function Add-Leaf($list, $x) {
  if ($x -is [System.Collections.IList]) { foreach ($e in $x) { Add-Leaf $list $e } }
  elseif ($null -ne $x) { $list.Add($x) }
}
function Get-Prop($o, [string]$n) { if ($null -ne $o -and $o.PSObject.Properties[$n]) { $o.$n } else { $null } }
function Get-RepoOf($i, [string]$fallback) {
  $u = [string](Get-Prop $i 'repository_url')
  if ($u) { $u -replace '^.*/repos/', '' } else { $fallback }
}
function Get-Labels($i) { @(Get-Prop $i 'labels' | ForEach-Object { if ($_ -is [string]) { $_ } else { [string]$_.name } }) }
function Get-Url([string]$repo, [int]$n) { "https://github.com/$repo/issues/$n" }
function Test-Leaf($i) {
  $l = Get-Labels $i
  ($l -contains 'pbi') -or ($l -contains 'bug') -or ([string]$i.title -match '^\[(PBI|Bug|Task)\]')
}

$requiresRx = '(?im)^\s*(?:[-*]\s*)?Requires:\s*([^/\s]+/[^@\s]+)@(\S+)\s+(released|rc)\b'
function Get-Requires([string]$body, [string]$source, $appliesTo) {
  foreach ($m in [regex]::Matches($body, $requiresRx)) {
    [ordered]@{ repository = $m.Groups[1].Value; milestone = $m.Groups[2].Value; kind = $m.Groups[3].Value.ToLowerInvariant(); source = $source; appliesTo = $appliesTo }
  }
}

$obj = Get-One "repos/$objRepo/issues/$objNumber"
$objRef = "$objRepo#$objNumber"
$requires = [System.Collections.Generic.List[object]]::new()
foreach ($r in @(Get-Requires ([string](Get-Prop $obj 'body')) $objRef $null)) { $requires.Add($r) }

# walk the native sub-issues down to the PBIs and Bugs; key owner/repo#nr, so equal numbers of two repos never collide
$seen = @{ $objRef = $true }
$leaves = [System.Collections.Generic.List[object]]::new()
$repoOrder = [System.Collections.Generic.List[string]]::new()
$stack = [System.Collections.Generic.Stack[object]]::new()
$stack.Push(@($objRepo, $objNumber))
while ($stack.Count) {
  $cur = $stack.Pop()
  $subs = Get-Paged "repos/$($cur[0])/issues/$($cur[1])/sub_issues?per_page=100"
  foreach ($s in $subs) {
    $repo = Get-RepoOf $s $cur[0]
    $key = "$repo#$($s.number)"
    if ($seen[$key]) { continue }
    $seen[$key] = $true
    if (-not $repoOrder.Contains($repo)) { $repoOrder.Add($repo) }
    if (Test-Leaf $s) { $leaves.Add([pscustomobject]@{ repo = $repo; issue = $s }); continue }
    foreach ($r in @(Get-Requires ([string](Get-Prop $s 'body')) $key $repo)) { $requires.Add($r) }
    $stack.Push(@($repo, [int]$s.number))
  }
}
# repositories named under ## Affected repos without children yet
$objBody = [string](Get-Prop $obj 'body')
if ($objBody -match '(?ms)^##\s*Affected repos\s*$(.*?)(?=^##\s|\z)') {
  foreach ($m in [regex]::Matches($Matches[1], '([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)')) { if (-not $repoOrder.Contains($m.Value) -and $m.Value -ne $objRepo) { $repoOrder.Add($m.Value) } }
}

# Requires: one milestone read per repository, one release-test read per milestone
$milestoneCache = @{}
function Find-Milestone([string]$repo, [string]$name) {
  if (-not $milestoneCache.ContainsKey($repo)) { $milestoneCache[$repo] = Get-Paged "repos/$repo/milestones?state=all&per_page=100" }
  $norm = { param($t) if ($t -match '^M([0-9]+(?:\.[0-9]+)*)(?=\s|\(|$)') { 'M' + ((@($Matches[1] -split '\.' | ForEach-Object { [string][int]$_ })) -join '.') } else { $null } }
  $want = & $norm $name
  @($milestoneCache[$repo] | Where-Object { $_.title -eq $name -or ($want -and (& $norm ([string]$_.title)) -eq $want) }) | Select-Object -First 1
}
$evalCache = @{}
foreach ($r in $requires) {
  $k = "$($r.repository)@$($r.milestone) $($r.kind)"
  if (-not $evalCache.ContainsKey($k)) {
    $e = [ordered]@{ met = $false; milestoneState = 'missing'; releaseTest = $null }
    $m = Find-Milestone $r.repository $r.milestone
    if ($m) {
      $e.milestoneState = [string]$m.state
      if ($m.state -eq 'closed') { $e.met = $true }
      elseif ($r.kind -eq 'rc') {
        $tests = @(Get-Paged "repos/$($r.repository)/issues?milestone=$($m.number)&labels=release-test&state=all&per_page=100" | Where-Object { $null -eq (Get-Prop $_ 'pull_request') } | Sort-Object { if ($_.state -eq 'open') { 0 } else { 1 } }, { - [int]$_.number })
        foreach ($t in $tests) {
          if (-not $e.releaseTest) { $e.releaseTest = Get-Url $r.repository ([int]$t.number) }
          $posted = [string](Get-Prop $t 'body') -match '<!-- release-test-rc -->'
          if (-not $posted) { $posted = (@(Get-Paged "repos/$($r.repository)/issues/$($t.number)/comments?per_page=100" | Where-Object { [string]$_.body -match '<!-- release-test-rc -->' })).Count -gt 0 }
          if ($posted) { $e.met = $true; $e.releaseTest = Get-Url $r.repository ([int]$t.number); break }
        }
      }
    }
    $evalCache[$k] = $e
  }
  $e = $evalCache[$k]
  $r.met = $e.met; $r.milestoneState = $e.milestoneState; $r.releaseTest = $e.releaseTest
}

$gates = [System.Collections.Generic.List[object]]::new()
$repos = [System.Collections.Generic.List[object]]::new()
foreach ($repo in $repoOrder) {
  $items = @($leaves | Where-Object { $_.repo -eq $repo } | ForEach-Object { $_.issue })
  $openItems = @($items | Where-Object { $_.state -eq 'open' })
  $ready = [System.Collections.Generic.List[object]]::new()
  $waitingItems = [System.Collections.Generic.List[object]]::new()
  foreach ($i in $openItems) {
    $ref = [ordered]@{ repository = $repo; number = [int]$i.number; title = [string]$i.title; url = Get-Url $repo ([int]$i.number) }
    $labels = Get-Labels $i
    $reason = $null
    if ($labels -contains 'release-test') { $reason = 'release test' }
    elseif ($labels -contains 'needs-decision') { $reason = 'needs-decision' }
    elseif ($labels -contains 'needs-refinement') { $reason = 'needs-refinement' }
    else {
      $sum = Get-Prop $i 'issue_dependencies_summary'
      $blockers = @()
      if ($null -eq $sum -or [int](Get-Prop $sum 'blocked_by') -gt 0) {
        $blockers = @(Get-Paged "repos/$repo/issues/$($i.number)/dependencies/blocked_by?per_page=100" | Where-Object { $_.state -eq 'open' } | ForEach-Object { "$(Get-RepoOf $_ $repo)#$($_.number)" })
      }
      if ($blockers.Count) { $reason = 'blocked by ' + ($blockers -join ', ') }
    }
    if ($reason) { $ref.reason = $reason; $waitingItems.Add($ref) } else { $ready.Add($ref) }
  }
  $repoRequires = @($requires | Where-Object { ($_.appliesTo -eq $repo) -or ($null -eq $_.appliesTo -and $_.repository -ne $repo) })
  $unmet = @($repoRequires | Where-Object { -not $_.met })
  $state = $null; $reason = $null
  if ($items.Count -and -not $openItems.Count) { $state = 'done' }
  elseif ($unmet.Count) { $state = 'waiting'; $reason = ($unmet | ForEach-Object { "requires $($_.repository)@$($_.milestone) $($_.kind)" } | Select-Object -Unique) -join ', ' }
  elseif ($ready.Count) { $state = 'ready' }
  elseif ($waitingItems.Count) { $state = 'waiting'; $reason = ($waitingItems | ForEach-Object { "$($_.repository)#$($_.number) $($_.reason)" }) -join '; ' }
  else { $state = 'waiting'; $reason = 'no PBI or Bug yet' }
  $status = if ($state -eq 'waiting') { "waiting($reason)" } else { $state }

  $openRelease = $null
  if ($items.Count) {
    $info = Get-One "repos/$repo"
    $branch = [string](Get-Prop $info 'default_branch'); if (-not $branch) { $branch = 'main' }
    $owner = ($repo -split '/')[0]
    $prs = @(Get-Paged "repos/${repo}/pulls?base=$branch&head=${owner}:release/next&state=open&per_page=100")
    if ($prs.Count) {
      $openRelease = [string]$prs[0].html_url
      $gates.Add([ordered]@{ type = 'release-pr'; repository = $repo; detail = "release/next into $branch open"; url = $openRelease })
    }
  }
  $repos.Add([ordered]@{
      repository = $repo; status = $status; state = $state; reason = $reason
      open = $openItems.Count; closed = ($items.Count - $openItems.Count)
      ready = @($ready); waiting = @($waitingItems); requires = @($repoRequires); releasePr = $openRelease
    })
}

foreach ($k in @($evalCache.Keys | Sort-Object)) {
  if ($evalCache[$k].met) { continue }
  $r = @($requires | Where-Object { "$($_.repository)@$($_.milestone) $($_.kind)" -eq $k })[0]
  $type = if ($r.kind -eq 'rc') { 'rc-missing' } else { 'not-released' }
  $gates.Add([ordered]@{ type = $type; repository = $r.repository; detail = "$($r.repository)@$($r.milestone) $($r.kind) (milestone $($evalCache[$k].milestoneState))"; url = $evalCache[$k].releaseTest })
}
if ($objBody -match '(?ms)^##\s*Acceptance Criteria\s*$(.*?)(?=^##\s|\z)') {
  $openBoxes = [regex]::Matches($Matches[1], '(?m)^\s*[-*]\s*\[ \]').Count
  if ($openBoxes) { $gates.Add([ordered]@{ type = 'acceptance-criteria'; repository = $objRepo; detail = "$openBoxes open"; url = Get-Url $objRepo $objNumber }) }
}

if ($Text) {
  $objUrl = Get-Url $objRepo $objNumber
  $allDone = $repos.Count -gt 0 -and @($repos | Where-Object { $_.state -ne 'done' }).Count -eq 0
  $needs = [System.Collections.Generic.List[string]]::new()
  foreach ($g in $gates) {
    if ($g.type -eq 'release-pr') { $needs.Add("merge the release PR of $($g.repository): $($g.url)") }
    elseif ($g.type -eq 'rc-missing') { $needs.Add("RC test $($g.detail)" + $(if ($g.url) { ": $($g.url)" } else { '' })) }
  }
  if ($allDone -and [string]$obj.state -eq 'open') { $needs.Add("Acceptance Criteria von $objRef prüfen und Objective schließen: $objUrl $([string]$obj.title)") }
  $nextRepo = $repos | Where-Object { $_.state -eq 'ready' } | Select-Object -First 1
  $shownNeeds = [math]::Min($needs.Count, 3)
  $cap = 12 - 3 - $shownNeeds
  $lines = [System.Collections.Generic.List[string]]::new()
  $lines.Add("Objective ${objRef}: $objUrl $([string]$obj.title)")
  $rl = @($repos | ForEach-Object { "$($_.repository): $($_.closed)/$($_.open + $_.closed) $($_.status)" })
  if ($rl.Count -gt $cap) { $rl = @($rl[0..($cap - 2)]) + "+$($rl.Count - $cap + 1) more repositories" }
  foreach ($l in $rl) { $lines.Add($l) }
  $lines.Add('Next: ' + $(if ($nextRepo) { $f = $nextRepo.ready[0]; "$($nextRepo.repository) $($f.url) $($f.title)" } else { '-' }))
  $lines.Add('Needs you:' + $(if ($needs.Count) { '' } else { ' -' }))
  for ($n = 0; $n -lt $shownNeeds; $n++) {
    $t = $needs[$n]
    if ($n -eq 2 -and $needs.Count -gt 3) { $t += " (+$($needs.Count - 3) more)" }
    $lines.Add("  $($n + 1). $t")
  }
  $lines -join "`n"
  exit 0
}

[ordered]@{
  objective = [ordered]@{ repository = $objRepo; number = $objNumber; title = [string]$obj.title; state = [string]$obj.state; url = Get-Url $objRepo $objNumber }
  requires = @($requires)
  repos = @($repos)
  gates = @($gates)
} | ConvertTo-Json -Depth 8
