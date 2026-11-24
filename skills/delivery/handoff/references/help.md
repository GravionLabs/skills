# /handoff

Writes this session as a handoff document for a fresh session: goal, state, next steps, open decisions, suggested skills and pointers. Secrets and personal data are replaced by `<REDACTED>`.

## Usage

```
/handoff [focus of the next session] [--path <file-or-dir>]
/handoff help
```

## Arguments and flags

- `focus`: what the next session should do; shapes Goal, Next steps and Suggested skills.
- `--path <file-or-dir>`: where to write. A directory gets `handoff-<yyyy-mm-dd>-<slug>.md`; default is the OS temp dir.
- `help` (also `--help`, `-h`): print this text.

Sections: Goal, State, Next steps, Open decisions, Suggested skills, Pointers. Content that is already in an issue, PR, ADR or commit is linked, not repeated. An existing file is never overwritten. The absolute path is reported.

Not part of it: starting the next session, memory files.

## Examples

```
/handoff
/handoff finish the review fixes of #959
/handoff continue the oxc migration --path ~/handoffs
/handoff help
```

## Config

none

## See also

- `deliver`, `planner`, `retro`: skills the next session usually loads
- `secret-scan`: scans a repository for committed secrets
