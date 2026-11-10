<#
.SYNOPSIS
  Fold the agent-events of one run (<run>.jsonl) into the run state and print it as JSON: the core state plus `deliver`.
.DESCRIPTION
  Core: the fold of GravionLabs/agent-events (SPEC.md "Run state", reference src/fold.ts, schema/v0/run-state.schema.json;
  pinned tag in test/skills/delivery/agent-events/VERSION). Its state fixtures are the contract: v, run, status (running,
  finished, abandoned), outcome, reason, text, subject, progress, step, tasks (open, in start order), finished (per outcome),
  attentions, needsYou, links, gaps, lastSeq, updated. Lines that are not JSON, an incomplete last line, unknown types
  (also the types before the core format: issue.started, milestone.progress, ...) and unknown fields are ignored; nothing
  folds after run.finished. abandoned: no run.finished and the last ts older than one hour at -Now, or (jsonl-file
  binding) the jsonl-file.pid of run.started no longer lives (-NoPidCheck turns that off).
  Deliver profile (deliver@1, schema/deliver-state.schema.json): `deliver` next to the core state, folded from the same
  events: source, harness, model, repository, milestone {key, title, url}, startedAt, result (running, abandoned or the
  deliver.result of run.finished), iteration {n, max}, delivered[] {pbi, url, prUrl}, blocked[], paused[], merging[],
  needsYou[] {number, url, reason} and release {reviewRound, prUrl, rcUrl, rcVersion, testIssue}. The latest outcome of an
  issue wins; the open RC test (deliver.release.updated testIssue) is needsYou with reason `RC test` until a task.finished
  of the test issue.
.PARAMETER Path
  The event file <run>.jsonl.
.PARAMETER Now
  ISO 8601 time the age rule compares against (default: the current time). Tests and fixtures pass it.
.PARAMETER NoPidCheck
  Skip the pid test of a run without run.finished (fixtures, a run of another host).
#>
[CmdletBinding()]
param(
  [string]$Path,
  [Parameter(ValueFromPipeline)][string[]]$InputObject,
  [string]$Now,
  [switch]$NoPidCheck
)
begin {
  $ErrorActionPreference = 'Stop'
  $lines = [System.Collections.Generic.List[string]]::new()
}
process {
  # pipeline items are complete lines (Get-Content strips the newline)
  foreach ($l in $InputObject) { if ($null -ne $l) { foreach ($p in ($l -split "`n")) { $lines.Add($p) } } }
}
end {
  # System.Text.Json instead of ConvertFrom-Json: timestamps stay the strings of the file (no DateTime conversion)
  function ConvertFrom-JsonElement([System.Text.Json.JsonElement]$e) {
    switch ($e.ValueKind.ToString()) {
      'Object' { $h = [ordered]@{}; foreach ($p in $e.EnumerateObject()) { $h[$p.Name] = ConvertFrom-JsonElement $p.Value }; return $h }
      'Array' { return , @(foreach ($x in $e.EnumerateArray()) { ConvertFrom-JsonElement $x }) }
      'String' { return $e.GetString() }
      'Number' { $n = 0L; if ($e.TryGetInt64([ref]$n)) { return $n }; return $e.GetDouble() }
      'True' { return $true }
      'False' { return $false }
    }
    return $null
  }
  function Write-Note([string]$text) { Write-Error "ConvertFrom-ProgressEvents: $text" -ErrorAction Continue }
  function Test-Number($v) { $v -is [long] -or $v -is [int] -or $v -is [double] }
  function Test-Map($v) { $v -is [System.Collections.IDictionary] }
  function Copy-Without($h, [string[]]$drop) { $c = [ordered]@{}; foreach ($k in $h.Keys) { if ($k -notin $drop) { $c[$k] = $h[$k] } }; return $c }
  function Add-Links($into, $more) {
    foreach ($l in @($more)) {
      if (-not (Test-Map $l)) { continue }
      if (-not @($into | Where-Object { $_.rel -eq $l.rel -and $_.url -eq $l.url })) { $into.Add($l) }
    }
  }
  function Get-Time([string]$ts) {
    $t = [DateTimeOffset]::MinValue
    if ($ts -and [DateTimeOffset]::TryParse($ts, [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AssumeUniversal, [ref]$t)) { return $t }
    return $null
  }

  if ($Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { Write-Note "no event file '$Path'"; exit 1 }
    $text = [System.IO.File]::ReadAllText((Resolve-Path -LiteralPath $Path).ProviderPath)
    $split = $text -split "`n"
    # the last line may still be written (no newline yet): skipped; after the last newline the list ends with ''
    for ($i = 0; $i -lt $split.Count - 1; $i++) { $lines.Add($split[$i]) }
  }
  $events = [System.Collections.Generic.List[System.Collections.Specialized.OrderedDictionary]]::new()
  foreach ($line in $lines) {
    if (-not $line.Trim()) { continue }
    try {
      $doc = [System.Text.Json.JsonDocument]::Parse($line)
      try { if ($doc.RootElement.ValueKind.ToString() -eq 'Object') { $events.Add((ConvertFrom-JsonElement $doc.RootElement)) } } finally { $doc.Dispose() }
    } catch { Write-Verbose "line skipped: not JSON" }
  }
  if (-not $events.Count) { Write-Note 'no progress events'; exit 1 }

  # --- core fold (agent-events src/fold.ts) ---
  $state = [ordered]@{ v = 1; status = 'running' }
  $tasks = [ordered]@{}
  $seen = @{}
  $finished = [ordered]@{ succeeded = [System.Collections.Generic.List[object]]::new(); failed = [System.Collections.Generic.List[object]]::new(); cancelled = [System.Collections.Generic.List[object]]::new(); skipped = [System.Collections.Generic.List[object]]::new() }
  $attentions = [System.Collections.Generic.List[object]]::new()
  $links = [System.Collections.Generic.List[object]]::new()
  $gaps = [System.Collections.Generic.List[object]]::new()
  $lastSeq = 0
  $updated = $null
  $pidValue = $null

  # --- deliver extension ---
  $dv = [ordered]@{ source = $null; harness = $null; model = $null; repository = $null; milestone = $null; startedAt = $null; result = 'running'; iteration = $null }
  $delivered = [ordered]@{}; $blocked = [ordered]@{}; $paused = [ordered]@{}; $merging = [ordered]@{}; $needs = [ordered]@{}
  $needIds = @{}
  $release = [ordered]@{ reviewRound = $null; prUrl = $null; rcUrl = $null; rcVersion = $null; testIssue = $null }
  $urls = @{}; $prs = @{}

  function Get-Nr($task) { if ([string]$task -match '^issue-(\d+)(\.\d+)?$') { return [int]$Matches[1] }; return 0 }
  function Get-IssueUrl([int]$n) {
    if ($urls.ContainsKey($n)) { return $urls[$n] }
    if ($dv.repository) { return "https://github.com/$($dv.repository)/issues/$n" }
    return "#$n"
  }
  function Get-Pr($ls) { foreach ($l in @($ls)) { if ((Test-Map $l) -and $l.rel -eq 'pull-request' -and $l.url) { return [string]$l.url } }; return $null }
  function New-Item2([int]$n, $reason) { [ordered]@{ number = $n; url = (Get-IssueUrl $n); reason = [string]$reason } }
  function Remove-Nr([int]$n, [string[]]$from) { foreach ($m in $from) { (Get-Variable $m -ValueOnly).Remove("$n") } }

  foreach ($e in $events) {
    if (-not (Test-Number $e.seq) -or $e.seq -le $lastSeq) { continue }
    if ($e.seq -gt $lastSeq + 1) { $gaps.Add([ordered]@{ from = $lastSeq + 1; to = $e.seq - 1 }) }
    $lastSeq = $e.seq
    $updated = $e.ts
    if ($null -eq $state.run -and $null -ne $e.run) { $state.run = $e.run }
    if ($state.status -eq 'finished') { continue }
    $type = [string]$e.type
    $nr = Get-Nr $e.task
    switch -CaseSensitive ($type) {
      'run.started' {
        if ($null -ne $e.subject) { $state.subject = $e.subject }
        if ((Test-Map $e.host) -and [string]$e.host['jsonl-file.pid'] -match '^\d+$') { $pidValue = [int]$e.host['jsonl-file.pid'] }
        if (-not $dv.startedAt) { $dv.startedAt = $e.ts }
        if (Test-Map $e.agent) { foreach ($k in 'harness', 'model') { if ($e.agent[$k]) { $dv[$k] = [string]$e.agent[$k] } } }
        if (Test-Map $e.deliver) {
          foreach ($k in 'source', 'repository') { if ($e.deliver[$k]) { $dv[$k] = [string]$e.deliver[$k] } }
          if ((Test-Map $e.deliver.milestone) -and $e.deliver.milestone.key) {
            $s = $e.subject
            $dv.milestone = [ordered]@{
              key = [string]$e.deliver.milestone.key
              title = $(if ((Test-Map $s) -and $s.title) { [string]$s.title } else { [string]$e.deliver.milestone.key })
              url = $(if ((Test-Map $s) -and $s.url) { [string]$s.url } else { $null })
            }
          }
        }
      }
      'run.finished' {
        $state.status = 'finished'
        if ($null -ne $e.outcome) { $state.outcome = $e.outcome }
        if ($null -ne $e.reason) { $state.reason = $e.reason }
        if ($null -ne $e.text) { $state.text = $e.text }
        $attentions.Clear()
        foreach ($t in $tasks.Values) {
          $c = Copy-Without $t 'step', 'progress'; $c.reason = 'run-finished'; $c.text = 'run finished'; $finished.cancelled.Add($c)
        }
        $tasks.Clear()
        $dv.result = if ((Test-Map $e.deliver) -and $e.deliver.result) { [string]$e.deliver.result } elseif ($e.outcome -eq 'succeeded') { 'done' } else { [string]$e.outcome }
      }
      'task.started' {
        $id = [string]$e.task
        if ($null -ne $e.task -and -not $seen.ContainsKey($id)) {
          $seen[$id] = $true
          $t = [ordered]@{ task = $e.task }
          if ($null -ne $e.parent) { $t.parent = $e.parent }
          if ($null -ne $e.subject) { $t.subject = $e.subject }
          $tasks[$id] = $t
          if ($nr -and (Test-Map $e.subject) -and $e.subject.url) { $urls[$nr] = [string]$e.subject.url }
        }
      }
      'task.finished' {
        $id = [string]$e.task
        if ($null -eq $e.task -or -not $tasks.Contains($id) -or [string]$e.outcome -cnotin 'succeeded', 'failed', 'cancelled', 'skipped') { break }
        $t = $tasks[$id]; $tasks.Remove($id)
        $c = Copy-Without $t 'step', 'progress'
        if ($null -ne $e.reason) { $c.reason = $e.reason }
        if ($null -ne $e.text) { $c.text = $e.text }
        $finished[[string]$e.outcome].Add($c)
        for ($i = $attentions.Count - 1; $i -ge 0; $i--) { if ($attentions[$i].task -eq $e.task) { $attentions.RemoveAt($i) } }
        if (-not $nr) { break }
        $pr = Get-Pr $e.links; if (-not $pr) { $pr = Get-Pr $t.links }; if ($pr) { $prs[$nr] = $pr }
        $o = if ((Test-Map $e.deliver) -and $e.deliver.outcome) { [string]$e.deliver.outcome } elseif ($e.outcome -eq 'succeeded') { 'delivered' } else { 'skipped' }
        $why = if ($e.text) { [string]$e.text } elseif ($e.reason) { [string]$e.reason } else { $o }
        if ($release.testIssue -and $release.testIssue.number -eq $nr -and $needs.Contains("$nr") -and $needs["$nr"].reason -eq 'RC test') { $needs.Remove("$nr") }
        switch ($o) {
          'delivered' {
            $delivered["$nr"] = [ordered]@{ pbi = $nr; url = (Get-IssueUrl $nr); prUrl = $(if ($prs.ContainsKey($nr)) { $prs[$nr] } else { $null }) }
            Remove-Nr $nr 'blocked', 'paused', 'needs', 'merging'
          }
          'skipped' { Remove-Nr $nr 'blocked', 'paused', 'needs', 'merging' }
          'blocked' { Remove-Nr $nr 'paused', 'merging'; $blocked["$nr"] = New-Item2 $nr $why }
          'paused' { Remove-Nr $nr 'blocked', 'merging'; $paused["$nr"] = New-Item2 $nr $why }
        }
      }
      { $_ -in 'step.started', 'step.finished' } {
        $t = $null
        if ($null -ne $e.task) { $t = $tasks[[string]$e.task]; if (-not $t) { break } }
        if ($t) { $t.step = $e.step } else { $state.step = $e.step }
        if ($type -eq 'step.finished' -and @($e.links).Count -and $null -ne $e.links) {
          if ($t) {
            if (-not $t.Contains('links')) { $t.links = [System.Collections.Generic.List[object]]::new() }
            Add-Links $t.links $e.links
          }
          Add-Links $links $e.links
        }
      }
      'progress' {
        $p = [ordered]@{ done = $e.done; total = $e.total }
        if ($null -ne $e.label) { $p.label = $e.label }
        if ($null -eq $e.task) { $state.progress = $p }
        elseif ($tasks.Contains([string]$e.task)) { $tasks[[string]$e.task].progress = $p }
      }
      'attention' {
        if (@($attentions | Where-Object { $_.id -eq $e.id }).Count) { break }
        $a = [ordered]@{ id = $e.id }
        if ($null -ne $e.task) { $a.task = $e.task }
        $a.reason = $e.reason
        if ($null -ne $e.text) { $a.text = $e.text }
        $a.needsYou = $e.needsYou
        if ($null -ne $e.links) { $a.links = $e.links }
        $attentions.Add($a)
        Add-Links $links $e.links
        $n = if ($nr) { $nr } elseif ((Test-Map $e.deliver) -and (Test-Number $e.deliver.issue)) { [int]$e.deliver.issue } else { 0 }
        if ($n -and $e.needsYou -eq $true) {
          $kind = if (Test-Map $e.deliver) { [string]$e.deliver.kind } else { '' }
          $why = if ($kind -eq 'release_test') { 'RC test' } elseif ($e.text) { [string]$e.text } else { 'needs you' }
          $needs["$n"] = New-Item2 $n $why
          $needIds[[string]$e.id] = $n
        }
      }
      'attention.resolved' {
        for ($i = 0; $i -lt $attentions.Count; $i++) { if ($attentions[$i].id -eq $e.id) { $attentions.RemoveAt($i); break } }
        $k = [string]$e.id
        if ($needIds.ContainsKey($k)) { $needs.Remove("$($needIds[$k])"); $needIds.Remove($k) }
      }
      'deliver.merging' {
        if (-not $nr -or -not $tasks.Contains([string]$e.task)) { break }
        $pr = Get-Pr $e.links; if (-not $pr) { $pr = Get-Pr $tasks[[string]$e.task].links }; if ($pr) { $prs[$nr] = $pr }
        Remove-Nr $nr 'blocked', 'paused', 'needs'
        $merging["$nr"] = [ordered]@{ number = $nr; url = (Get-IssueUrl $nr); prUrl = $(if ($prs.ContainsKey($nr)) { $prs[$nr] } else { $null }) }
      }
      'deliver.release.updated' {
        $d = $e.deliver
        if (-not (Test-Map $d)) { break }
        if ($d.pr) { $release.prUrl = [string]$d.pr }
        if ($d.rcUrl) { $release.rcUrl = [string]$d.rcUrl }
        if ($d.rcVersion) { $release.rcVersion = [string]$d.rcVersion }
        if ((Test-Number $d.round) -and $d.round -ge 1) { $release.reviewRound = [int]$d.round }
        if ((Test-Map $d.testIssue) -and (Test-Number $d.testIssue.number) -and $d.testIssue.number -ge 1) {
          $ti = [int]$d.testIssue.number
          if ($d.testIssue.url) { $urls[$ti] = [string]$d.testIssue.url }
          $old = $release.testIssue
          if ($old -and $old.number -ne $ti -and $needs.Contains("$($old.number)") -and $needs["$($old.number)"].reason -eq 'RC test') { $needs.Remove("$($old.number)") }
          $release.testIssue = [ordered]@{ number = $ti; url = (Get-IssueUrl $ti) }
          $needs["$ti"] = New-Item2 $ti 'RC test'
        }
      }
      'deliver.iteration' {
        if ((Test-Map $e.deliver) -and (Test-Number $e.deliver.n)) { $dv.iteration = [ordered]@{ n = [int]$e.deliver.n; max = [int]$e.deliver.max } }
      }
    }
  }

  if ($state.status -eq 'running') {
    $nowAt = if ($Now) { Get-Time $Now } else { [DateTimeOffset]::UtcNow }
    $last = Get-Time ([string]$updated)
    if ($updated -is [string] -and $last -and ($nowAt - $last).TotalMilliseconds -gt 3600000) { $state.status = 'abandoned' }
    elseif ($pidValue -and -not $NoPidCheck -and -not (Get-Process -Id $pidValue -ErrorAction SilentlyContinue)) { $state.status = 'abandoned' }
  }
  if ($state.status -eq 'abandoned') { $dv.result = 'abandoned' }
  $state.tasks = @($tasks.Values)
  $state.finished = $finished
  $state.attentions = $attentions
  $state.needsYou = [bool]@($attentions | Where-Object { $_.needsYou -eq $true }).Count
  $state.links = $links
  $state.gaps = $gaps
  $state.lastSeq = $lastSeq
  if ($null -ne $updated) { $state.updated = $updated }

  $dv.model = if ($dv.model) { $dv.model } else { 'default' }
  $dv.delivered = @($delivered.Values)
  $dv.blocked = @($blocked.Values)
  $dv.paused = @($paused.Values)
  $dv.merging = @($merging.Values)
  $dv.needsYou = @($needs.Values)
  $dv.release = $release
  $state.deliver = $dv
  ConvertTo-Json -InputObject $state -Depth 20
  exit 0
}
