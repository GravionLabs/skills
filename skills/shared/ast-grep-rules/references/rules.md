# ast-grep rules: details

## Gate wiring

In `.agents/config.json` of the target repository (the script is copied to `scripts/ast-grep-rules/`):

```json
{
  "checks": [
    { "name": "ast-grep scan", "command": "ast-grep scan", "fast": true },
    { "name": "ast-grep test", "command": "ast-grep test", "fast": true },
    {
      "name": "ast-grep rules",
      "command": "node scripts/ast-grep-rules/check-rules.mts",
      "fast": true
    }
  ]
}
```

`ast-grep scan` reads `sgconfig.yml` of the working directory; run it from the directory that holds the file, or add `--config <path>`.

## Rule and rule test

```yaml
# ast-grep/rules/no-console-log.yml
id: no-console-log
language: TypeScript
severity: error
message: 'Why: console output hides in production logs (see the incident). Instead: use the logger from src/log.ts. See #123.'
rule:
  pattern: console.log($$$ARGS)
```

```yaml
# ast-grep/rule-tests/no-console-log-test.yml
id: no-console-log
valid:
  - logger.info(value)
invalid:
  - console.log(value)
```

A file may hold several rules separated by `---`; each needs its own test.

## What `check-rules.mts` checks

- every rule (a YAML document with a top-level `id`) has a `message` with `Why: …`, `Instead: …` and `See #<n>` (also `Fixes #<n>`, `Refs owner/repo#<n>`);
- a rule test with the same `id` exists in a `testDir` of `sgconfig.yml`;
- the YAML reading is line-based (top-level `id` and `message`, plain, quoted, `>` and `|` scalars); it does not evaluate the rule.

## Pitfalls

- Do not call `sg`; use `ast-grep`.
- The rule test `id` must equal the rule `id`, otherwise `ast-grep test` reports the rule as untested.
- Ban a pattern, not a file: use `files`/`ignores` for scope, not a path in the message.
