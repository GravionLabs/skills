# Skill trigger evals

Skill descriptions decide whether a model loads a skill. `evals/skill-triggers.json` holds, per model-invocable skill, prompts that should trigger it (`shouldTrigger`) and prompts that should not (`shouldNotTrigger`). `scripts/Invoke-TriggerEvals.ps1` runs them headless and scores which skill the model chose.

## Run

```powershell
pnpm install                                       # Node >= 22; the scorer is plain Node, no build
pwsh scripts/Invoke-TriggerEvals.ps1 -DryRun       # lists prompts and the command, calls nothing (also -WhatIf)
pwsh scripts/Invoke-TriggerEvals.ps1 -Runs 3 -Out evals/results/trigger-results.json
pwsh scripts/Invoke-TriggerEvals.ps1 -Baseline <earlier-result>.json -Out evals/results/latest.json
pwsh scripts/Invoke-TriggerEvals.ps1 -Skill code-review,diagnose   # subset
```

Install the skills first (`npx skills add GravionLabs/skills` in the directory you run from; `.claude/skills` and `.agents/skills`, project or home, are checked) so `claude` sees them. Each prompt goes to `claude -p <prompt> --output-format stream-json --verbose --model sonnet --max-turns 4 --tools Skill,Read,Glob,Grep --disallowedTools Edit Write MultiEdit Bash NotebookEdit Task WebFetch WebSearch` (a read-only allow-list plus a deny list keeps the model from changing the repo); Skill `tool_use` calls in the transcript are the chosen skills (a `plugin:skill` name counts as `skill`). A session without a `result` event or with an error result (auth, rate limit, crash; hitting `--max-turns` is fine) is retried once and then recorded with `failed: true`; failed runs are excluded from all rates and reported, and the scorer exits 2 when more than 10 % of the sessions failed. Exit codes: 0 ok, 1 threshold or baseline regression, 2 crash, bad input or too many failed sessions.

## Cost caveat

Every prompt runs `-Runs` times (default 3) as a real model session: with the current set every prompt is a call. The runner uses `-Model sonnet`, `-MaxTurns 4` and runs `-ThrottleLimit 8` sessions in parallel; the model, runs and date are stored under `meta` in the result. Run it on demand, never in CI, and use `-Skill` or `-Runs 1` while iterating.

## Result schema

```json
{
  "summary": {
    "overall": { "positives": 0, "negatives": 0, "triggerRate": 0, "falseTriggerRate": 0 },
    "skills": [
      { "skill": "name", "positives": 0, "negatives": 0, "triggerRate": 0, "falseTriggerRate": 0 }
    ]
  },
  "records": [
    { "skill": "name", "kind": "positive|negative", "prompt": "...", "invoked": ["skill"] }
  ],
  "meta": { "date": "YYYY-MM-DD", "model": "sonnet", "runs": 3, "maxTurns": 4 },
  "notInstalled": ["skill"],
  "sampleSize": { "prompts": 0, "runs": 0, "failed": 0 },
  "failedRuns": 0,
  "warnings": [],
  "thresholdFailures": [],
  "regressions": []
}
```

Records may carry `failed: true`. Rates are percent (0-100). `triggerRate` is the share of positive runs where the expected skill was invoked; `falseTriggerRate` the share of negative runs where it was invoked anyway. A result file is a valid `-Baseline`; a file without a usable `summary` is rejected with exit 2. A baseline with another model, run count or `notInstalled` set, or with skills missing from the run, produces a `warnings` entry. Only skills present in both runs are compared, `overall` included.

## Threshold

- Trigger rate on should-trigger prompts >= 80 %.
- False-trigger rate on should-not-trigger prompts <= 10 %.
- Regression: a re-run fails when a trigger rate drops, or a false-trigger rate rises, by more than 5 points (after rounding to one decimal) against the baseline (overall or per skill).

The numbers live in `scripts/skill-trigger-score.mjs` (plain Node, no build; `node scripts/skill-trigger-score.mjs extract|score` is the CLI the runner calls).

## Baseline

No baseline is committed yet: the one of apm-hub was measured with apm-hub installs and is not carried over. Run the evals once with the skills installed, keep the result file (`evals/results/` is ignored by Git) and pass it as `-Baseline` on later runs. Skills that are not installed (`.claude/skills` and `.agents/skills` of the directory you run from and of your home) are skipped and listed under `notInstalled`, never scored 0 %. haiku rarely consults skills, so sonnet is the default. Prompts must be substantive tasks: one-line prompts are answered directly.

## When to re-run

After changing a skill `description` or adding or removing a model-invocable skill. A re-run is compared against the earlier result for regressions. The offline check that the eval set matches the skills on disk (`scripts/skill-trigger-evals.mjs`; group `skill-tooling` and skills with `disable-model-invocation` are excluded, `check-prerequisites` has no case yet) runs in `pnpm test`.
