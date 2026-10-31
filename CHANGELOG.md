# Changelog

All notable changes to GravionLabs/skills are documented here.
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.0.1] — 2026-10-30

### Bug Fixes
- **test**: Group paths in the ported routing test; trigger evals are not ported yet


### Features
- Port the unreleased apm-hub release/next (#881-#907)


## [1.0.0] — 2026-10-30

### Bug Fixes
- Dead runner link in working mode; vitest failures as CI annotations
- **test**: Group paths in the remaining tests; skill names in backticks stay bare
- **statusline**: Installed skill path stays flat (.claude/skills/context-statusline)


### Documentation
- Update CHANGELOG.md for v1.0.0 [skip ci]


### Features
- Skills of GravionLabs/apm-hub 3.3.0, flat under skills/, installed with npx skills


### Refactoring
- Skills in group folders skills/<group>/<name>/



