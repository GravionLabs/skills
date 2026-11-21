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

## Starter rules

Check them from the skill directory: `ast-grep test --config templates/sgconfig.starter.yml` and `node scripts/check-rules.mts --config templates/sgconfig.starter.yml --allow-placeholder`. Snapshots live in `templates/rule-tests/__snapshots__/` (copy them too). The rules use `language: Tsx` and `languageGlobs` of the starter config maps `*.ts`, `*.mts`, `*.cts` to it, so one rule covers all three; `files` limits them to `*.test.*` and `*.spec.*`. The reason comment sits on the line above the statement; a trailing comment does not count.

## Opt-in rules

`templates/optional/` (rules, rule-tests, snapshots, `sgconfig.yml`) holds `no-module-mock-outside-tests`, `no-widen-then-assert` and `no-reduce-copy-accumulator`. None is enabled by default. To enable one:

1. Copy `optional/rules/<id>.yml` to `ast-grep/rules/`, and `optional/rule-tests/<id>-test.yml` plus `optional/rule-tests/__snapshots__/<id>-snapshot.yml` to `ast-grep/rule-tests/` (with its `__snapshots__/`).
2. Replace `#<nr>` in the message with the issue of your incident, and adjust `files`/`ignores` to the repository layout.
3. Run `ast-grep test`, `ast-grep scan`, fix or baseline the violations, then `node scripts/check-rules.mts`.

Check the templates from the skill directory: `ast-grep test --config templates/optional/sgconfig.yml` and `node scripts/check-rules.mts --config templates/optional/sgconfig.yml --allow-placeholder`. `.ts` sources need the `languageGlobs` of that config (or of `sgconfig.starter.yml`) because the rules use `language: Tsx`.

## Pitfalls

- Do not call `sg`; use `ast-grep`.
- The rule test `id` must equal the rule `id`, otherwise `ast-grep test` reports the rule as untested.
- Ban a pattern, not a file: use `files`/`ignores` for scope, not a path in the message.
