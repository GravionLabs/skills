## Skill Audit Checklist

Checks and severities only. The rules themselves live in `../../skill-write/references/skill-writing-rules.md`; read that first and check each item against it.

Severity: 🔴 critical (invalid, fails validation) · 🟡 important (reduces reliability or triggering) · 🟢 suggestion.

### Location

- [ ] Correct placement (package skill vs `.github/skills/` contributor tooling) — 🟢

### Frontmatter

- [ ] `name` present — 🔴; well-formed and matches directory — 🟡
- [ ] `description` present — 🔴; imperative, specific triggers, not over-broad — 🟡
- [ ] Only allowed top-level keys — 🔴 for any forbidden or unknown key; the client keys `disable-model-invocation`, `user-invocable`, `context`, `agent` are allowed
- [ ] `compatibility`, `chronicle-hints`, `model`, `allowed-tools` as top-level keys — 🔴; recommendation: remove, or move annotations to `metadata:`
- [ ] `disable-model-invocation: true` is paired with `metadata.opencode/autoinvoke: 'false'` — 🔴 if missing; 🟡 if set on a skill that other skills load by name
- [ ] `context: fork` only on a self-contained skill whose body states its return contract — 🟡
- [ ] `metadata` values are free-form strings — 🟢

### Body

- [ ] ≤ 100 lines — 🟡
- [ ] Reference material, long templates and multi-step commands are in `references/`, `assets/`, `scripts/` — 🟡/🟢
- [ ] Shell fences are ` ```powershell ` — 🔴
- [ ] Decisions written as `If X → Y; otherwise Z`; gotchas section present where non-obvious facts exist — 🟢
- [ ] No content the model already knows, no vague advice, no equal alternatives without a default — 🟡
- [ ] No duplication of another skill's steps — 🟡
- [ ] Not tied to one concrete task — 🟢
- [ ] Companion paths stated as relative to the skill directory; no `$env:SKILL_DIR` — 🟡

### `scripts/` (if present)

- [ ] `--help` — 🟡; no interactive prompts — 🔴; non-zero exit with helpful message — 🟡
- [ ] Data on stdout, diagnostics on stderr; dependencies pinned — 🟢

### `references/` and `assets/` (if present)

- [ ] Each file has a conditional load instruction in `SKILL.md` — 🟡
- [ ] Paths relative from the skill root — 🔴 if absolute; no chain deeper than one level — 🟡
- [ ] Assets hold templates/data, not prose — 🟢
