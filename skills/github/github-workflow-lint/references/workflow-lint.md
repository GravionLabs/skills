# Workflow lint details

## Tools and versions

| Tool       | Version | Checks                                                                   |
| ---------- | ------- | ------------------------------------------------------------------------ |
| actionlint | 1.7.12  | syntax, expressions, inputs of reusable workflows, `run:` via shellcheck |
| zizmor     | 1.32.0  | security: `template-injection`, `unpinned-uses`, excessive permissions   |

Versions were checked against the releases when the skill was written; re-check when updating.

## Recording a finding

- zizmor: a comment on the line, `# zizmor: ignore[template-injection] value is a constant of this workflow`. The reason after the rule is required; a bare ignore is rejected in review.
- actionlint: `.github/actionlint.yaml` with `paths:` and `ignore:` regexes, each with a comment naming the reason.
- Prefer fixing: pass `${{ }}` values through `env:` instead of inlining them in `run:`; pin actions to a SHA.

## Gate wiring

`checks` entries of `.agents/config.json` with `fast: true` run before the tests and after every fix. The entry is added only in repositories that have `.github/workflows/`; without workflows the script prints `skipped: no workflows` and exits 0 anyway.

## Exit codes

| Code | Meaning                                            |
| ---- | -------------------------------------------------- |
| 0    | clean, or `skipped: no workflows`                  |
| 1    | actionlint or zizmor reported a finding            |
| 2    | a tool is missing (actionlint, zizmor, shellcheck) |
