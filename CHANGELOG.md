# Changelog

All notable changes to GravionLabs/skills are documented here.
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [1.3.1] — 2026-11-02

### Bug Fixes
- **deliver**: Propose a space-first herdr sidebar layout (#158)


## [1.3.0] — 2026-11-01

### Bug Fixes
- **delivery**: Release review round-3 pause is recorded and not repeated (#137) (#141)
- **delivery**: Step 9 reads the milestone once with -State all (#155) (#156)


### Documentation
- **delivery**: Herdr sidebar layout starts with the repo (#149) (#150)
- Update CHANGELOG.md for v1.3.0 [skip ci]


### Features
- **skill-tooling**: Help convention and test helper for user-invoked skills (#105) (#138)
- **github**: Github-pull-request copies the skip-adr label onto the PR (#136) (#142)
- **delivery**: /skills-install help from references/help.md (#108) (#143)
- **delivery**: /deliver help from references/help.md (#106) (#144)
- **delivery**: /planner help from references/help.md (#107) (#145)
- **github**: /github-release help from references/help.md (#109) (#146)
- **delivery**: /retro help from references/help.md (#110) (#147)
- **statusline**: /context-statusline help from references/help.md (#111) (#148)


### Performance
- **delivery**: Read milestone issues in one batched REST call (#127) (#140)


## [1.2.1] — 2026-11-01

### Bug Fixes
- **ci**: Recreate release/next after the release (#133)


### Documentation
- Update CHANGELOG.md for v1.2.1 [skip ci]


## [1.2.0] — 2026-11-01

### Bug Fixes
- Deliver must select PBIs and bugs (#103) (#116)
- Deliver loses the implementer notes, spec notes never reach review and PR (#97) (#118)
- Get-GovernanceMatches diffs HEAD instead of the reviewed branch (#98) (#119)
- Governance spec check treats files like latest.ts as tests (#99) (#120)
- Standalone issue merges into main with --squash (#130) (#134)
- Release review runs governance on the wrong diff without waivers (#131) (#132)


### Documentation
- Roadmap records v1.1.0 and plans 1.2.0 (#85)
- Overview, roadmap and governance page for 1.2.0 (#112) (#129)
- Update CHANGELOG.md for v1.2.0 [skip ci]


### Features
- **shared**: Adr skill and the governance config key (#65) (#88)
- **deliver**: Write the review result to a file (#53) (#89)
- **shared**: Spec rules in implementation (#66) (#90)
- **dotnet**: Dotnet-aspire skill for local orchestration (#61) (#91)
- **shared**: Detect-techstack reports ADRs, specs and governance (#68) (#92)
- **shared**: Code-review checks the ADR and spec rules (#67) (#93)
- **delivery**: Planner applies the ADR and spec rules (#86) (#94)
- **delivery**: Deliver handles decision PBIs and spec notes (#87) (#95)
- **delivery**: Deliver reviews release/next with Opus before the release PR (#100) (#121)
- **github**: Github-milestone skill shows the current and all milestones (#113) (#122)


### Performance
- **github**: Move hot gh reads and CI polling off GraphQL (#117) (#123)


### Refactoring
- **github-release**: Finish derives the bump from Conventional Commits (#101) (#124)


## [1.1.0] — 2026-10-31

### Bug Fixes
- GitVersion bumps the minor version on a release merge into main (#73) (#77)


### Documentation
- Roadmap records v1.0.2 and plans 1.1.0 (#73) (#74)
- Roadmap moves the herdr plugin of #17 to herdr-plugins (#17) (#75)
- Roadmap plans Node.js 26 in 1.1.0 and lists the open issues (#72) (#76)
- Update CHANGELOG.md for v1.1.0 [skip ci]


### Features
- **deliver**: Merge into release/next without asking, end a milestone with the release PR (#78) (#79)
- **delivery**: Invoke-DeliverLoop shows its log in a herdr split pane (#12) (#81)
- **delivery**: Deliver reports step, issue and PR as herdr pane tokens (#16) (#82)
- **delivery**: Toggle the deliver log pane with a herdr key (#13) (#83)


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
- Update CHANGELOG.md for v1.0.2 [skip ci]


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



