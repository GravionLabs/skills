# Changelog

All notable changes to GravionLabs/skills are documented here.
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.0.2] — 2026-10-31

### Bug Fixes
- **shared**: Format-Changed formats the .jsx, .css and .html files it detects as ts (#33) (#36)
- **shared**: Get-Lessons -Check reports duplicate ids; retro separates draft errors (#44)
- **delivery**: List a failed branch delete in left (#45) (#46)
- **delivery**: Keep CI watch output unbuffered (#47) (#50)
- **delivery**: The Copilot CLI allowlist of deliver names each git write subcommand (#49) (#52)
- **delivery**: Remove-PbiWorktrees deletes merged branches with git branch -d first (#55) (#60)
- Find the flaky tests of pnpm run check (#56) (#62)


### Documentation
- ROADMAP.md for 1.1.0
- Roadmap lists the lessons PBIs #23-#28 (#29)
- Roadmap lists the lessons PBIs and puts herdr in 1.2.0 (#14) (#31)
- **delivery**: Skills-install warns that a global skill copy can shadow the project install (#48) (#51)
- Roadmap records retro #6 and the workflow.js decision (#6) (#58)


### Features
- **shared**: Lessons skill with contract and Get-Lessons.ps1 loading (#34)
- **delivery**: Skills-install names the !.agents/lessons/ gitignore exception (#26) (#35)
- **delivery**: Unattended deliver skips PBIs labelled interactive (#38)
- **shared**: Get-Lessons.ps1 -Check validates lesson files for CI (#39)
- **shared**: Implementation, code-review and planner read lessons (#25) (#40)
- **delivery**: Retro drafts lessons with status proposed (#27) (#41)
- **delivery**: Retro proposes retiring ineffective lessons (#42)


### Refactoring
- **delivery**: Remove the frozen workflow.js (#57) (#63)


## [1.0.1] — 2026-10-30

### Bug Fixes
- **test**: Group paths in the ported routing test; trigger evals are not ported yet


### Documentation
- Update CHANGELOG.md for v1.0.1 [skip ci]


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



