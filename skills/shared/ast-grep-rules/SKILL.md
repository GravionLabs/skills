---
name: ast-grep-rules
description: 'Keep structural bans as ast-grep rules with a reason, a replacement and the causing issue, each with a rule test. Use for "add an ast-grep rule", "ban this pattern", "check the ast-grep rules".'
---

A repository keeps its structural bans as ast-grep rules. A rule says why the pattern is banned, what to write instead and which issue caused the rule, and a rule test proves it. Paths are relative to this skill's directory. Node >= 22.18 runs the check script (`.mts`, no build).

The binary is `ast-grep`. Never call `sg`: on Linux it is the shadow-utils command. No template or script of this skill uses it.

## When to add a rule

Only after a real incident or a review finding that a pattern should not return. Never speculatively, never for a style taste (that is the formatter's or linter's job). A rule without an issue or PR number is not added.

## Layout in the target repository

- `sgconfig.yml` at the root (`templates/sgconfig.yml`): `ruleDirs: [ast-grep/rules]`, `testConfigs: [{testDir: ast-grep/rule-tests}]`.
- One rule per file in `ast-grep/rules/<id>.yml` (`templates/rule.yml`); `id` is kebab-case and unique.
- One rule test per rule in `ast-grep/rule-tests/<id>-test.yml` (`templates/rule-test.yml`) with `valid` and `invalid` snippets; its `id` is the rule's id.

## Message rule

Every `message` has three parts, in this form:

`Why: <the reason>. Instead: <the replacement>. See #123.`

The number is the issue or PR that caused the rule. A message the reader cannot act on is a blocking finding in review.

## Add a rule

1. Write the failing case as an `invalid` snippet in the rule test first.
2. Write the rule and the message; `ast-grep test` passes, `ast-grep scan` lists the violations in the code.
3. Fix the violations in the same change (or baseline them with the `ratchet` skill when there are many).
4. Run `node scripts/check-rules.mts [--config sgconfig.yml]`: exit 1 names every rule whose message lacks the reason, the replacement or the issue, or that has no rule test of its id; exit 2 on a usage error or a missing `sgconfig.yml`.

## Gate

Wire the three commands as `checks` entries of `.agents/config.json` with `fast: true` so `implementation` and the gate run them (example in `references/rules.md`):

- `ast-grep scan`
- `ast-grep test`
- `node scripts/ast-grep-rules/check-rules.mts` (copy of this skill's script)

Details, rule syntax pointers and pitfalls: `references/rules.md`.
