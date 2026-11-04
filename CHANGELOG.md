# Changelog

All notable changes to GravionLabs/skills are documented here.
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [2.0.0] — 2026-11-04

### Bug Fixes
- **delivery**: Verify the Copilot harness and the Copilot context hook against a live Copilot CLI (#220) (#251)
- **delivery**: Deliver-loop shim and herdr state verified against a live herdr, quoting gaps closed (#221) (#252)
- **github**: Github-milestone close validates -MoveTo first and covers its failure paths (#222) (#253)
- **delivery**: Read-only reviewers, PR skill reads the pushed branch, delivery tests under 10 s (#224) (#256)
- **delivery**: Deliver-loop shim runs in the repository root (#227) (#258)
- **docs**: ROADMAP.md is reproducible by the roadmap skill (#270) (#271)
- **delivery**: Roadmap state keeps the repository of a foreign blocker (#272) (#275)
- **delivery**: Roadmap scripts find github-milestone in the installed flat layout (#276) (#277)


### Documentation
- **github**: Release routine creates the next milestone before close --move-to (#226) (#257)
- **deliver**: One herdr sidebar layout instead of two (#228) (#259)
- Stale loop and milestone wording, group table cell test (#229) (#260)
- Migrating legacy x.y.z milestones to M<n>, tamias as example (#243) (#263)
- Refresh ROADMAP.md to M<n> and 1.6.0 with the roadmap skill (#248) (#268)


### Features
- **github**: Milestones M<n> and M<n> (x.y.z), close renames (#234) (#237)
- **delivery**: Deliver and loop work with M<n> milestones (#235) (#239)
- **github**: Release routine closes M<n> and creates the next (#236) (#240)
- **github**: Github-release defines the back-merge of main into release/next (#223) (#254)
- **github**: Milestones accept a topic name, M<n> <Topic> (x.y.z) (#249) (#261)
- **github**: Github-milestone rename mode for legacy x.y.z titles (#242) (#262)
- **delivery**: Roadmap skill skeleton and Get-RoadmapState.ps1 (#244) (#264)
- **delivery**: Roadmap proposes M<n> assignment and sets milestones after approval (#245) (#265)
- **delivery**: Roadmap writes and updates ROADMAP.md after approval (#246) (#266)
- **delivery**: Roadmap help, marketplace entry, tables, trigger eval, guide (#247) (#267)
- **github**: Insert a milestone between M<n> and M<n+1> with sub-numbers and insert (#255) (#269)


### Refactoring
- **ng**: Rename skill ng-ag-grid-developer to ng-ag-grid (#273) (#274)


## [1.5.0] — 2026-11-03

### Bug Fixes
- **deliver**: Merge main (v1.4.1 hotfixes #201, #202) back into release/next (#216) (#217)


### Documentation
- Herdr page with the GravionLabs herdr plugins (#177) (#208)
- Update CHANGELOG.md for v1.4.1 [skip ci]
- Guides and AGENTS.md mention the loop features of 1.5.0 (#219) (#225)
- Update CHANGELOG.md for v1.5.0 [skip ci]


### Features
- **delivery**: Invoke-DeliverLoop.ps1 supports -Harness copilot (#186) (#210)
- **delivery**: Deliver-loop shell shim offered by skills-install (#187) (#211)
- **delivery**: Deliver loop reports its lifecycle state to herdr (#191) (#212)
- **delivery**: Deliver loop colors its console output, log pane is opt-in (#193) (#213)
- **statusline**: Context-statusline installs a context warning hook (#205) (#214)
- **github**: Github-milestone closes a milestone after its release tag (#206) (#215)


## [1.4.1] — 2026-11-02

### Bug Fixes
- **site**: Dev server shows a blank page (#201)
- **deliver**: Loop console output is cut at 120 characters and uncolored (#202)


### Documentation
- Update CHANGELOG.md for v1.4.1 [skip ci]


## [1.4.0] — 2026-11-02

### Documentation
- **site**: Remove apm-hub leftovers from the site package and skills concept page (#163) (#183)
- **site**: Reorder the sidebar, guides before concepts (#170) (#184)
- **site**: Quick start page on the site (#171) (#185)
- Guide for planning an issue with planner and grill-me (#172) (#188)
- Step-by-step guide for /deliver (#173) (#189)
- Split common workflows into stack setup, manual issue and bug-fix guides (#174) (#192)
- Guide for releasing a milestone, including the release/next ruleset (#175) (#194)
- Concept pages for the issue model and skill composition (#178) (#195)
- Troubleshooting page (#179) (#196)
- Guide for learning from runs with retro and lessons (#176) (#198)
- Update CHANGELOG.md for v1.4.0 [skip ci]


### Features
- **site**: Logo and favicon for the documentation site (#162) (#182)
- **retro**: Flow diagram of the agent calls of a run (#181) (#197)


## [1.3.2] — 2026-11-02

### Bug Fixes
- **deliver**: Name PRs and issues as full URLs (#199)


### Documentation
- Update CHANGELOG.md for v1.3.2 [skip ci]


## [1.3.1] — 2026-11-02

### Bug Fixes
- **deliver**: Propose a space-first herdr sidebar layout (#158)


### Documentation
- Update CHANGELOG.md for v1.3.1 [skip ci]


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



