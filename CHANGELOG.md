# Changelog

All notable changes to GravionLabs/skills are documented here.
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [4.1.0] — 2026-11-09

### Bug Fixes
- **github-release**: Recognize the local path of release-branch.yml (#506)
- **deliver**: A nested session's run.finished no longer sets the loop result to done (#463)
- **deliver**: Loop sets a wait ceiling that does not cut a subagent off (#461)


### Features
- **shared**: Test key in the project config and a runner that does not guess the test tool (#507)


### Refactoring
- **delivery**: Remove the terminal sink, the owner rule and the token functions (#417)


## [4.0.0] — 2026-11-09

### Bug Fixes
- **deliver**: Loop starts the session with the PBI it logs the iteration under (#488) (#497)
- Deliver-loop tests ignore the developer's poimen and herdr terminal (#460) (#500)


### Documentation
- **github-issue**: The RC of a desktop app installs side by side (#504)
- Update CHANGELOG.md for v4.0.0 [skip ci]


### Features
- **deliver**: Deliver-loop stops before the next PBI on a stop request (#474) (#484)
- **deliver**: Deliver-loop stop requests a stop of the running loop (#475) (#486)
- **deliver**: Deliver-loop stop --now ends the iteration after the current step (#476) (#487)
- **deliver**: Merge by auto-merge instead of watching the checks (#480) (#489)
- **deliver**: Pick up PRs waiting for auto-merge in select (#481) (#496)
- Github-pages skill for a site/ on GitHub Pages (#492) (#499)


### Refactoring
- ⚠️ **Breaking**: **delivery**: Remove status.json, its writer and the file contract (#376) (#495)
- Move the public docs from docs/ to site/ (493) (#498)
- Pages.yml uses the ci VitePress workflow (#494) (#501)


## [3.4.0] — 2026-11-08

### Bug Fixes
- Sub-issues from another repository count as outside the milestone (#438) (#445)
- **delivery**: Find github-milestone in an installed layout (#446) (#454)
- Deliver preflight asks for js-implementation and js-test that no group installs (#447) (#455)
- **roadmap**: Milestone rule is checked per target, not over the whole assignment (#464) (#470)
- **github-milestone**: Assign dry run on a missing milestone validates; renumber resolves the repository (#465) (#471)
- **roadmap**: New-Roadmap matches block keys by numeric value after renumber (#466) (#472)
- **deliver**: One milestone key form in docs, schema and state files (#468) (#477)
- **docs**: Github-milestone modes renumber and assign documented (#469) (#478)
- **docs**: ADR 0003 supersedes ADR 0002 in part (#467) (#483)


### Documentation
- Set milestones only through github-milestone assign (#440) (#449)
- **adr**: The progress event format lives in agent-events (#451) (#456)
- M<nnn> milestone format in skills and guides (#436) (#444)
- Update CHANGELOG.md for v3.4.0 [skip ci]


### Features
- Zero-padded milestone numbers in github-milestone (#433) (#442)
- Github-milestone assign mode enforces the milestone rule (#439) (#448)
- Renumber mode migrates existing milestones (#434) (#458)
- Padded milestone titles in roadmap, release and github-project scripts (#435) (#459)


### Refactoring
- **delivery**: Drop the deliver-loop.ansi.log (#441) (#453)
- **deliver**: Schema and event fixtures come from agent-events (#452) (#457)


## [3.3.0] — 2026-11-07

### Bug Fixes
- **docs**: AGENTS.md says github-project is not in this repository (#428) (#430)
- Github-project live tests exceed the time budget and hit the worker timeout (#429) (#431)


### Documentation
- Update CHANGELOG.md for v3.3.0 [skip ci]


### Features
- **delivery**: Get-RunState.ps1 lists runs, folds one and tails its events (#415) (#426)
- **delivery**: Terminal sink behind DELIVER_TERMINAL_SINK, marked deprecated (#416) (#427)
- **github**: Add the github-project skill from GravionLabs/ci (#424)


## [3.2.0] — 2026-11-07

### Bug Fixes
- **delivery**: A nested harness session ends the loop's run early with its own run.finished (#397) (#403)
- Release-test PBI is delivered as work before step 9, so the RC is never cut first (#398) (#404)
- OlderReleaseTests also includes the release-test issues of newer milestones (#399) (#405)
- Nothing emits the attention kinds pr_opened, review_fix and ci_red (#400) (#406)
- An interactive session's run.started records a pid that has already exited (#401) (#407)
- Release-test rule in milestones.md says the gate is not yet implemented (#402) (#408)
- Finish looks up the release-test issue by exact milestone title, topic milestones skip the RC gate (#409) (#410)
- A nested harness session's run.started is appended to the loop's run and a nested run.finished is not stopped (#411) (#419)
- Release-test rule in milestones.md still says deliver selects it as the last open item (#412) (#421)


### Documentation
- **adr**: Agent progress events replace status.json (#381) (#380)
- **github-release**: Issues close on merge into release/next (#382) (#396)
- **adr**: Displays read the progress events (#420) (#418)
- Update CHANGELOG.md for v3.2.0 [skip ci]


### Features
- **delivery**: Progress event schema with tone and the Report-Progress emitter (#369) (#384)
- **delivery**: ConvertFrom-ProgressEvents reducer with run-state schema and paired fixtures (#370) (#386)
- **delivery**: Terminal sink in Report-Progress with tokens, agent state and deliver_tone (#371) (#387)
- **delivery**: Deliver reports every progress line through Report-Progress in any backend (#373) (#389)
- **delivery**: Retention for event files and stream recordings (#375) (#391)
- **delivery**: Release-test label, always the last item of a milestone, cuts the RC (#377) (#392)
- **delivery**: Step 9 cuts the RC and opens the release PR without waiting for the RC test (#378) (#393)
- **github-milestone**: Create the release-test issue with the milestone (#379) (#394)


### Refactoring
- **delivery**: Loop writes run events and status.json from the projection (#372) (#388)
- **delivery**: Console, ansi log and notifications from events, progress-line regex removed (#374) (#390)


## [3.1.0] — 2026-11-06

### Bug Fixes
- **delivery**: Paused PBIs are no longer counted as delivered by the loop (#346) (#351)
- **delivery**: Count milestone progress over PBIs and Bugs only (#347) (#352)
- **delivery**: Control session does not pin -Model on the loop (#348) (#353)
- **delivery**: Docs name the tier default for the loop -Model (#349) (#354)
- **delivery**: Use the real poimen-server report syntax for tokens and clear (#350) (#355)
- **delivery**: List poimen-server report in its own permissions row (#356) (#361)
- **delivery**: Describe closed and total of the status schema as PBIs and Bugs (#357) (#362)
- **docs**: Remove the repeated preflight sentence from the AGENTS.md delivery row (#359) (#364)
- **delivery**: Control session handles the loop result max reached (#360) (#365)


### Documentation
- Update CHANGELOG.md for v3.1.0 [skip ci]


### Features
- **shared**: Project-setup with format per language and .editorconfig (#306) (#315)
- **shared**: Lint key in the project config, runner and project-setup choice (#307) (#317)
- **shared**: Project-setup proposes the governance key (#308) (#318)
- **shared**: Project-setup adds .gitattributes, .gitignore and pre-commit hooks (#309) (#326)
- **delivery**: Write review findings in poimen's findings.json format (#232) (#328)
- **shared**: Project-setup writes VS Code settings, tasks and launch configs (#310) (#330)
- **delivery**: Skills-manage offers project-setup after an install (#311) (#333)
- **shared**: Project-setup writes Zed settings, tasks and debug configs (#313) (#334)
- **shared**: Project-setup writes JetBrains shared run configurations (#314) (#335)
- **delivery**: Status block after each PBI and deliver status (#320) (#336)
- **delivery**: Interactive milestone run as a thin control session over the loop (#321) (#337)
- **github**: Release finish closes the milestone and checks the version after the merge (#322) (#338)
- **delivery**: Preflight for repo skills, allowlist and stale worktrees (#323) (#339)
- **delivery**: Feedback during a run becomes issues in the milestone (#324) (#340)
- **delivery**: Tier and model per PBI visible in select, status and loop (#325) (#341)
- **delivery**: Milestones hold PBIs and Bugs, Features only when complete, Epics never (#327) (#342)
- **delivery**: JSON schema and fixtures for the deliver loop status.json (#332) (#344)
- **delivery**: Deliver loop reports milestone progress, status.json and backend tokens (#329) (#345)


### Refactoring
- **delivery**: Terminal backend adapter for herdr and poimen in the deliver scripts (#331) (#343)


## [3.0.0] — 2026-11-05

### Documentation
- Update CHANGELOG.md for v3.0.0 [skip ci]


### Refactoring
- **delivery**: Rename skill-manage to skills-manage (#299) (#300)
- **skills**: Remove the obsolete group (#302) (#303)


## [2.2.0] — 2026-11-05

### Documentation
- README, AGENTS and docs name skill-manage (#293) (#298)
- Update CHANGELOG.md for v2.2.0 [skip ci]


### Features
- **delivery**: Skill-manage with install and update (#291) (#295)
- **obsolete**: Group obsolete with skills-install as a forwarder (#292) (#297)


## [2.1.0] — 2026-11-05

### Bug Fixes
- **statusline**: Use %USERPROFILE% on Windows instead of ~ for hook and status line paths (#231) (#282)
- Skills-install cannot update installed skills or pick up new group members (#278) (#284)
- **skills-install**: -Update skips the update when npx skills check exits 1 (#285) (#287)
- **skills-install**: -Update reports a failing newMembers child process (#286) (#288)


### Documentation
- Update CHANGELOG.md for v2.1.0 [skip ci]


### Features
- **statusline**: Context warning threshold follows the context window size (#289) (#294)


## [2.0.1] — 2026-11-04

### Documentation
- **skills-install**: After-install.md names the ng-ag-grid rename (#279) (#280)
- Update CHANGELOG.md for v2.0.1 [skip ci]


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
- Update CHANGELOG.md for v2.0.0 [skip ci]


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



