# GLOSSARY.md format

File `GLOSSARY.md` at the repository root. Created with the first resolved term, never empty. Adapted from `GLOSSARY-FORMAT.md` of mattpocock/skills (MIT).

```markdown
# Glossary

Canonical terms of this repository. Use them in code, issues, pull requests and prompts.

## Terms

### Gate

The single check command that formats, lints and tests the changed files before a commit.

_Avoid_: pre-flight, quality check

- Relates to: [Tier](#tier) (the tier decides how much of the gate runs).

### Tier

The model strength an item is delivered with: fast, standard or strong.

_Avoid_: level, class

## Flagged ambiguities

- "release" — a git tag, or the `release/next` branch? Candidates: Release, Release branch.
```

## Entry

- `### <Term>`: the canonical term, singular, capitalized as in running text.
- One line: the definition, what it is (not how it is built). No file names, classes, commands or versions.
- `_Avoid_:` the synonyms and near-misses to avoid, comma-separated. Omit the line when there are none.
- `- Relates to:` relationships to other terms, linked by anchor, each with a short reason. Optional.

## Rules

- Terms sorted alphabetically under `## Terms`.
- One entry per term; a rename keeps the old name under `_Avoid_`.
- `## Flagged ambiguities` holds unresolved terms with their candidates; an entry moves to `## Terms` when resolved. Omit the section when empty.
- No implementation details, no history, no examples longer than the definition.
