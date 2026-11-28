# Changelog

All notable changes to GravionLabs/skills are documented here.
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [6.2.0] — 2026-11-28

### Features
- **skills**: Target Node.js 26 and pnpm 12 in templates and new projects (#1187)


## [6.1.0] — 2026-11-28

### Documentation
- The Objective mode of deliver-loop in the skill, references and site (#1130) (#1178)
- **adr**: Delivery runs as host-neutral workflow skills next to the loop (#1139) (#1149)


### Features
- **deliver**: Read an Objective and evaluate its Requires across repositories (#1118) (#1133)
- **deliver**: --objective with --dry-run prints the plan of an Objective (#1119) (#1134)
- **deliver**: An Objective run clones the repositories it works on (#1120) (#1135)
- **deliver**: Parallel sessions in one repository with deliver.parallel (#1121) (#1136)
- **deliver-triage**: Role session that judges one attention case within fixed actions (#1126) (#1148)
- **deliver**: Deliver.parallel counts per repository with default 1 (#1137) (#1150)
- **deliver**: An Objective run works one frontier across its repositories (#1122) (#1138)
- **deliver**: Run folder, report and events of an Objective run (#1124) (#1173)
- **deliver**: Stop and resume an Objective run (#1125) (#1175)
- **deliver**: The loop starts deliver-triage on an attention event and applies its result (#1127) (#1176)
- **deliver**: Report open pull requests of other milestones before the release gate (#1128) (#1177)
- **deliver**: One GitHub App token per repository of an Objective run (#1123) (#1172)
- Reference host-verbs.md names the host verbs a workflow skill uses (#1167) (#1174)


### Refactoring
- **deliver**: The milestone loop runs as a module per repository (#1117) (#1131)


## [6.0.1] — 2026-11-28

### Documentation
- **adr**: Deliver-triage takes an issue out of the run instead of deferring it (#1114) (#1115)


## [6.0.0] — 2026-11-27

### Bug Fixes
- **github-release**: The changelog skips the release tooling's own commits (#1089)
- ⚠️ **Breaking**: **deliver**: Deliver and publish events follow the agent-events profile rule (#1112) (#1113)


### Documentation
- **adr**: Milestones hold Features as a roadmap and record what a release shipped (#1076) (#1068)
- **github-issue**: The milestone rule of ADR 0010 and Requires on a Feature (#1069) (#1099)
- **adr**: Objective runs in three layers: loop code, deliver-triage, poimen as host (#1081) (#1105)
- **deliver**: An orchestrator starts subagents and panes with the resolved model (#1087) (#1108)
- **site**: The delivery model from Objective to release, guides and references updated (#1083) (#1111)


### Features
- **retro**: The deliver run folder as the metrics source (#1057) (#1088)
- **retro**: Escaped findings per milestone (#1058) (#1091)
- **deliver**: A retro session before the release PR posts its drafts as a checklist (#1059) (#1092)
- **retro**: An Objective retro aggregates the milestone retros (#1060) (#1093)
- **retro**: File the ticked drafts of a retro comment (#1061) (#1094)
- **deliver-review**: Review against the parent Feature and the style guide rubric (#1062) (#1095)
- **github-release**: Finish checks the publish run and the tag before it closes the milestone (#1064) (#1096)
- **planner**: Protected paths checked against the planned files (#1065) (#1097)
- **deliver**: Events for merge, hand-over, set-aside and the end of a milestone (#1066) (#1098)
- **github-milestone**: Assign Features without their PBIs, PBIs get their milestone at merge (#1070) (#1100)
- **planner**: Planner and roadmap plan Features into milestones, never PBIs (#1071) (#1101)
- **deliver**: --milestone works the PBIs below its Features, --feature works one Feature (#1072) (#1102)
- **github-release**: Cut makes sure an open milestone exists (#1073) (#1103)
- **deliver**: A models setting and a resolver for the model of a role (#1085) (#1106)
- **deliver**: The loop picks the implementer model by the PBI tier and the other roles by the resolver (#1086) (#1107)
- **github-milestone**: Migrate mode moves open milestones to Features only (#1074) (#1104)
- **deliver**: A risk-high pull request is handed over instead of merged (#1063) (#1109)
- **deliver**: Events in the per-user directory with their origin (#1078) (#1110)


## [5.16.0] — 2026-11-26

### Documentation
- **ng-implementation**: Style-lint uses the Helix lint preset (#1031) (#1047)
- **github-release**: A release job that fails after the merge is completed by a re-run (#1039) (#1049)


### Features
- **ng-helix**: Skill with Helix components and form and dialog recipes (#1042) (#1050)
- **ng-helix**: Helix-desktop reference (#1044) (#1051)
- **ng-helix**: Migration from raw controls and lint preset wiring (#1045) (#1052)
- **ng-helix**: Testing Helix components by role and keyboard (#1046) (#1053)
- **ng-helix**: Tokens and theming reference (#1043) (#1054)


## [5.15.0] — 2026-11-26

### Features
- **ui-styleguide**: Form field and dialog rules in the templates and fill.md (#1026) (#1032)
- **ui-styleguide**: Sync mode proposes a diff between a guide and the code (#1027) (#1034)
- **ui-styleguide**: Audit mode checks screenshots against the rubric (#1028) (#1035)
- **ng-implementation**: Helix primitives instead of raw controls (#1029) (#1036)
- **ui-styleguide**: A project guide extends a base guide (#1030) (#1037)


## [5.14.0] — 2026-11-26

### Features
- **deliver**: Review runs as its own session with its own model (#1013) (#1018)
- **deliver**: The loop keeps the issue stage in agent labels (#1014) (#1020)
- **deliver**: Feature pull requests are transport, the issue is the human surface (#1015) (#1021)
- **ng**: File naming follows angular.json, not the files that happen to exist (#1019) (#1022)
- **deliver**: A resumed run keeps the risk level and the review findings (#1023) (#1024)


### Refactoring
- **vault**: Vault-pdf calls nixe export --format pdf and drops Export-VaultPdf.ps1 (#1008) (#1016)


## [5.13.0] — 2026-11-25

### Features
- **vault**: Vault-pdf writes notes as PDF through nixe and a headless browser (#1006) (#1007)


## [5.12.0] — 2026-11-25

### Features
- **vault**: Vault-inbox proposes the import and files only after the approval (#999) (#1002)
- **vault**: The school inbox is named Inbox and attachments never point to the inbox (#1000) (#1004)
- **vault**: Combine the profiles PARA and school in one vault (#1001) (#1005)


## [5.11.0] — 2026-11-24

### Features
- **github**: Github-triage for issues filed by others (#957) (#992)
- **delivery**: Handoff skill (#959) (#995)
- **shared**: Prototype skill (#960) (#996)
- **shared**: Wizard skill for steps only a human can take (#961) (#997)
- **shared**: Architecture-survey skill for deepening opportunities (#962) (#998)
- **shared**: Glossary skill and grill-me --docs (#958) (#994)


## [5.10.0] — 2026-11-24

### Documentation
- **github-issue**: Gh 2.94 shortcuts, open-blocker count and the close --comment trap (#954) (#989)


### Features
- **code-review**: Spec section reports missing, unrequested and wrong behavior (#951) (#985)
- **code-review**: Fowler smell baseline as notes (#952) (#987)
- **github-pull-request**: Summary as the smallest visual (#953) (#988)
- **planner**: Test seams are a planning decision (#956) (#991)
- **planner**: PBI and Bug state current and desired behavior and out of scope (#955) (#990)


## [5.9.0] — 2026-11-24

### Features
- **deliver**: A dependency-only change of Cargo.toml is not protected (#970) (#979)
- **deliver**: A catalog-only change of pnpm-workspace.yaml is not protected (#971) (#981)
- **deliver**: A dependency-only change of pyproject.toml is not protected (#972) (#982)
- **deliver**: A require-only change of go.mod is not protected (#973) (#983)
- **deliver**: A PackageVersion-only change of Directory.Packages.props is not protected (#974) (#984)


## [5.8.0] — 2026-11-24

### Features
- **deliver**: Repair the conflict of a handed-over pull request before handing it over (#965) (#969)
- **deliver**: Resolve lockfile conflicts by regenerating the lockfile (#966) (#976)
- **deliver**: A dependency-only change of package.json is not protected (#967) (#977)
- **deliver**: Wait for a handed-over pull request instead of ending with exit 3 (#968) (#978)


## [5.7.0] — 2026-11-23

### Documentation
- **site**: Evaluate mattpocock/skills on the frameworks page (#950) (#963)


### Features
- **vault**: The vault skills inbox, clip, summarize, meeting, decision, weekly review, recipe (#924) (#940)
- **school**: The school skills as group school (#926) (#942)
- **vault**: Vault-setup with the profiles PARA and school and an update of the core rules (#925) (#943)
- **skills-manage**: The groups vault and school (#927) (#944)


## [5.6.0] — 2026-11-23

### Bug Fixes
- Deliver opens a second pull request for an issue that already has one (#928) (#935)
- **deliver-loop**: Merged PR that does not close the PBI makes the loop stall (#893) (#936)
- **deliver**: An incomplete run reports done with a warning, not error, over OSC 7501 (#921) (#937)


### Features
- CI job template that scans the pull request range with gitleaks (#844) (#915)
- Rust-implementation common lint set and clippy.toml template (#846) (#917)
- Rust-implementation deny.toml template for cargo-deny (#847) (#918)
- Convert-AllowToExpect.ps1 migrates allow attributes to expect with a reason (#848) (#919)
- Gate mapping and review rules name cargo deny and the common lint set (#849) (#920)
- **setup-oxc-husky**: Stylelint lints CSS and SCSS (#922) (#938)


## [5.5.0] — 2026-11-21

### Features
- **deliver**: The loop repeats its OSC 7501 status as a heartbeat (#912) (#913)


## [5.4.1] — 2026-11-21

### Bug Fixes
- **ci**: The release job gets 30 minutes (#909) (#910)


## [5.4.0] — 2026-11-21

### Bug Fixes
- **ci**: PR checks passed no longer goes green while the tests of the head run (#898) (#899)
- **ci**: Migrate the dependency dashboard keys of renovate.json5 (#904) (#905)
- **deliver**: Oxlint no longer reports NodeJS.Timeout in deliver-loop.mts (#902) (#906)
- Pnpm run typecheck is green and part of pnpm run check and CI (#895) (#907)


### Documentation
- Native baselines and the stale-entry wrapper for the ratchet skill (#804) (#857)
- Language implementation skills name the gate (#810) (#863)
- Derive a first style guide from an existing UI repository (#822) (#873)
- .agents/proof/ is gitignored in this repository and named in after-install (#832) (#883)


### Features
- Ratchet skill with baseline helper (entry and count baselines) (#798) (#850)
- Ratchet runner that discovers and runs the ratchet scripts (#799) (#852)
- File-size ratchet (#800) (#853)
- Lint-suppression ratchet (#801) (#854)
- Any and ts-nocheck ratchet (#802) (#855)
- Skipped-tests ratchet (#803) (#856)
- CI job template for the ratchet runner (#805) (#858)
- Gate convention, gate config key and AGENTS.md wording (#806) (#859)
- Check-changed.mts runs the checks a change needs (#807) (#860)
- Check-changed pass cache and --base (#808) (#861)
- Implementation and deliver call the gate (#809) (#862)
- Claude Code Stop hook template that runs the gate (#811) (#864)
- Ast-grep-rules skill with layout, message rule and rule check (#813) (#865)
- Ast-grep starter rules for tests (TypeScript) (#814) (#866)
- Opt-in anti-slop ast-grep rules (#815) (#867)
- Check-prerequisites requires ast-grep where sgconfig.yml exists (#816) (#868)
- Code-review proposes an ast-grep rule for a repeated finding (#817) (#869)
- Ui-styleguide skill with STYLEGUIDE.md template and deep-dive templates (#819) (#870)
- UX review rubric template with a fixed output format (#820) (#871)
- Code-review loads the UX rubric for UI diffs (#821) (#872)
- Stylelint template that enforces tokens in Angular repositories (#823) (#874)
- Agents-md skill with target structure, size budget and admission rule (#824) (#875)
- Check-agents-md.mts reports a file over budget and reference files without a reading condition (#825) (#876)
- Ratchet on the size of AGENTS.md (#826) (#877)
- Pull request description carries Suggested AGENTS.md additions (#828) (#879)
- Pull request body carries Risk and Visual proof sections (#829) (#880)
- Implementer result carries risk and visual proof (#830) (#881)
- Deliver passes risk and visual proof to the pull request and reports the risk level (#831) (#882)
- Job-timeout ratchet for GitHub Actions workflows (#835) (#885)
- Github-workflow-lint skill runs actionlint and zizmor (#838) (#886)
- Check-prerequisites installs actionlint, zizmor and shellcheck (#839) (#887)
- CI job template that runs the workflow lint (#840) (#888)
- Secret-scan skill with gitleaks config and allowlist rule (#842) (#890)
- Check-prerequisites installs gitleaks where .gitleaks.toml exists (#843) (#891)
- Ts-create-project and ts-pnpm-workflow set minimumReleaseAge (#833) (#884)
- Check that a pnpm repository sets minimumReleaseAge (#834) (#892)
- This repository gets check:changed (#812) (#896)
- **delivery**: Poimen-lead skill for the start, wait, read, report loop (#889)
- This repository runs ast-grep scan and test in its checks (#818) (#900)


### Refactoring
- This repository's AGENTS.md within the budget, details in reference files (#827) (#878)


## [5.3.0] — 2026-11-20

### Bug Fixes
- **ts**: Setup-oxc-husky flags long inline styles as inline declarations (#790) (#791)
- **statusline**: Context-statusline installs a subagent line that Claude Code removed in 2.1.323 (#745) (#792)
- **deliver**: A rate-limit wait does not use up a retry, a secondary limit waits longer (#682) (#796)
- **shared**: Implementation runs fast static checks first and limits the full-suite rerun (#794) (#797)


### Features
- **deliver**: Report the loop state with OSC 7501 (#581) (#787)
- **deliver**: The TypeScript loop applies the harness failure and session timeout rules (#681) (#795)


## [5.2.0] — 2026-11-20

### Bug Fixes
- **deliver**: The stop-request test fails now and then in CI (#747) (#772)
- **github-release**: The release-branch template does not pass the CI app secrets (#750) (#773)


### Documentation
- **adr**: Oxlint and oxfmt are the lint and format standard (#769) (#782)


### Features
- **ng**: CSS as the default style language, SCSS only as an exception (#748) (#749)
- **planner**: Cut PBIs that change protected paths into their own interactive PBI (#752) (#774)
- **deliver**: The report names the PBIs that wait for a handed-over PR (#753) (#776)
- **deliver**: Progress bar with x of y at the start of each issue in the loop output (#780) (#781)
- **ts**: Setup-oxc-husky replaces the Biome and the Prettier/ESLint setup skills (#770) (#783)


## [5.1.0] — 2026-11-18

### Bug Fixes
- **deliver**: Deliver-loop ends with one line instead of a stack trace outside a git repository or on an unknown option (#712) (#721)
- **deliver**: A milestone without open issues ends with a failed release pull request (#714) (#724)
- **deliver**: A released milestone stays open and no step points to closing it (#715) (#725)
- **deliver**: A session that scheduled a wakeup keeps the loop waiting up to 20 minutes (#717) (#727)
- **deliver**: An issue whose pull request is already merged is started again or set aside (#718) (#728)
- **deliver**: The guard repeats a failed read, runs before a session and keeps the blocked reason (#719) (#729)
- **github-milestone**: Close refuses a version that a second milestone of the same release needs (#716) (#726)
- **deliver**: The loop merges into the default branch with a merge commit (#740) (#742)


### Features
- **deliver**: A pull request handed over for protected paths does not look like a failure (#713) (#723)
- **deliver**: The loop checks release/next before every PBI and repairs a red one (#674) (#731)


## [5.0.2] — 2026-11-18

### Bug Fixes
- Pull requests target main unless a milestone or a release branch is the target (#736)
- **deps**: Renovate opens its pull requests against the default branch (#737)


## [5.0.1] — 2026-11-18

### Bug Fixes
- **deps**: 7-day minimum release age (#730)


## [5.0.0] — 2026-11-16

### Bug Fixes
- Check formatting is red on release/next (biome, 3 errors) (#668) (#676)
- **deliver**: Exit 3 for a missing release/next in the docs and in objective mode (#648) (#664)
- **deliver**: A merged issue unblocks its dependents and an incomplete run does not end as succeeded (#688) (#697)
- **deliver**: A session always merges the base branch, never rebases (#701) (#703)
- **test**: Cap vitest workers at 4 so loop cases do not time out locally (#679) (#708)


### Documentation
- **deliver**: Merge row of the preflight table names the missing release/next (#649) (#665)
- **deliver**: Site, shim and installer describe the new loop (#695) (#711)


### Features
- **deliver**: Loop core in TypeScript with arguments, GitHub state and stop rules (#613) (#653)
- **deliver**: LoopHost interface, process host and session record parsers (#614) (#662)
- **deliver**: The loop sets a blocked or paused PBI aside and goes on (#655) (#677)
- **deliver**: A harness or GitHub failure does not count against a PBI (#672) (#678)
- **deliver**: The loop creates a missing release/next itself (#671) (#684)
- **deliver**: Deliver-min, the minimal skill with its loop, the GitHub tracker and tests (#687) (#696)
- **deliver**: The loop ends a finished milestone with the release pull request (#690) (#698)
- **deliver**: The loop runs on Windows (#689) (#699)
- **deliver**: The loop mints the session token from the GitHub App (#692) (#702)
- **deliver**: The Copilot harness delivers an issue (#691) (#700)
- **deliver**: Deliver-loop checks the set and prints a run plan before it starts (#673) (#704)
- **deliver**: Deliver-loop refine collects the open questions of a set before a run (#675) (#706)


### Refactoring
- **deliver**: Remove the desktop notifications of the loop (#705) (#707)
- ⚠️ **Breaking**: **deliver**: Remove the old deliver skill, the PowerShell loop and the Objective mode (#693) (#709)
- **deliver**: Deliver-min becomes deliver (#694) (#710)


## [4.4.0] — 2026-11-15

### Bug Fixes
- Ts-pnpm-workflow provides pnpm through corepack on Node 26 (#609) (#610)
- Heartbeat takeover race still open between second read and PATCH (#593) (#624)
- Get-RepoLoopLabel can show the result of an older run (#594) (#625)
- Deliver-loop stop between rounds does not point to release (#595) (#626)
- **deliver**: Soften the acceptance-criteria gate wording and fix a stale comment (#597) (#628)
- **deliver**: Finish open and merging tasks before run.finished (#600) (#630)
- **deliver**: Informational attentions are not left open (#602) (#632)
- **deliver**: Issue titles and milestone url in event subjects (#601) (#631)
- **deliver**: A partial run result is succeeded with a warning tone (#603) (#640)
- Deliver-loop reports no progress when the PR merges by auto-merge right after the session (#605) (#642)
- Objective status shows a repository as ready when its loop can only skip interactive or claimed PBIs (#604) (#641)
- **deliver**: Preflight and loop check that release/next exists (#633) (#645)
- **deliver**: The loop sends desktop notifications inside a poimen terminal (#634) (#646)


### Documentation
- **deliver**: Document ignored invalid Requires refs and stale context.md removal (#596) (#627)
- Refresh ROADMAP.md with M015 to M017 and the releases up to v4.3.1 (#638) (#639)
- **adr**: The deliver loop runs as TypeScript on Node behind a host interface (#612) (#622)


### Features
- **deliver**: File the release-review notes as issues automatically (#598) (#629)
- **deliver**: Repair an existing PR of the own branch instead of pausing (#608) (#644)
- **deliver**: Deliver.parallel defaults to 3 across repositories (#599) (#647)


### Performance
- **deliver**: Reuse and parallelize the objective context file (#607) (#643)


## [4.3.1] — 2026-11-13

### Bug Fixes
- Takeover-during-a-round runner test is flaky (#572) (#582)
- Heartbeat PATCH can overwrite a takeover -Force (#573) (#585)
- Validate owner/repo of Requires: lines before building checkout paths (#574) (#586)
- Objective loop shows wrong status for repo loops and misses the acceptance-criteria gate (#575) (#587)
- Deliver-loop stop has no defined effect on an objective run (#576) (#588)
- **deliver**: Objective rc trigger without preflight and stale context.md (#578) (#590)


### Documentation
- **implementation**: One wording for the background-persistence rule (#579) (#591)


### Performance
- **deliver**: Read only new closed PRs per objective round (#577) (#589)


## [4.3.0] — 2026-11-12

### Bug Fixes
- Contract-change rule reads the label from the PR, deliver sets it on the PBI (#570) (#571)


### Features
- **deliver**: Deliver-loop -Objective runs rounds over the ready repositories (#543) (#561)
- **deliver**: Runner marker, heartbeat and takeover for an objective (#544) (#564)
- **deliver**: Pause downstream on contract-change and trigger the RC (#545) (#565)
- **deliver**: -Context file with upstream PRs for the fix subagent (#546) (#566)
- **deliver**: Interactive /deliver --objective control session (#547) (#567)
- **deliver**: Deliver.parallel runs several loops across repositories (#548) (#568)
- **implementation**: Forbid background persistence in apps (#563) (#569)


## [4.2.0] — 2026-11-11

### Bug Fixes
- **github-issue**: Read cross-repository blocked-by links with their repository (#536) (#552)
- Get-ObjectiveStatus ignores Requires lines on PBIs and Bugs (#559) (#560)


### Documentation
- **adr**: ADR 0004 Objectives coordinate milestones across repositories (#533) (#549)


### Features
- **github-issue**: The [Objective] level above Epic (#535) (#551)
- **deliver**: Label contract-change when a PR touches contracts.paths (#537) (#553)
- **deliver**: Get-ObjectiveStatus.ps1 reads an objective across repositories (JSON) (#538) (#554)
- **planner**: Plan an objective into Features of the target repositories (#541) (#555)
- **deliver**: Get-ObjectiveStatus -Text status block with gates (#539) (#556)
- **planner**: Refine an objective checks repos, release edges and criteria (#542) (#558)


## [4.1.3] — 2026-11-10

### Bug Fixes
- **deliver**: Delivered[].prUrl falls back to the issue URL (#511) (#522)
- **deliver**: Delivered[].prUrl is null without a pull-request link (#511) (#521)
- **github-release**: Move release/next by fast-forward instead of deleting it (#530)


## [4.1.2] — 2026-11-10

### Bug Fixes
- **deliver**: A control session opens no run next to the loop run (#517)
- **deliver**: Control-session run test uses its own events dir, Select and Watch event ownership stated (#517)


## [4.1.1] — 2026-11-10

### Refactoring
- **deliver**: Emit agent-events core plus deliver profile (#452) (#518)


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

### Refactoring
- **delivery**: Rename skill-manage to skills-manage (#299) (#300)
- **skills**: Remove the obsolete group (#302) (#303)


## [2.2.0] — 2026-11-05

### Documentation
- README, AGENTS and docs name skill-manage (#293) (#298)


### Features
- **delivery**: Skill-manage with install and update (#291) (#295)
- **obsolete**: Group obsolete with skills-install as a forwarder (#292) (#297)


## [2.1.0] — 2026-11-05

### Bug Fixes
- **statusline**: Use %USERPROFILE% on Windows instead of ~ for hook and status line paths (#231) (#282)
- Skills-install cannot update installed skills or pick up new group members (#278) (#284)
- **skills-install**: -Update skips the update when npx skills check exits 1 (#285) (#287)
- **skills-install**: -Update reports a failing newMembers child process (#286) (#288)


### Features
- **statusline**: Context warning threshold follows the context window size (#289) (#294)


## [2.0.1] — 2026-11-04

### Documentation
- **skills-install**: After-install.md names the ng-ag-grid rename (#279) (#280)


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
- Guides and AGENTS.md mention the loop features of 1.5.0 (#219) (#225)


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


### Features
- **site**: Logo and favicon for the documentation site (#162) (#182)
- **retro**: Flow diagram of the agent calls of a run (#181) (#197)


## [1.3.2] — 2026-11-02

### Bug Fixes
- **deliver**: Name PRs and issues as full URLs (#199)


## [1.3.1] — 2026-11-02

### Bug Fixes
- **deliver**: Propose a space-first herdr sidebar layout (#158)


## [1.3.0] — 2026-11-01

### Bug Fixes
- **delivery**: Release review round-3 pause is recorded and not repeated (#137) (#141)
- **delivery**: Step 9 reads the milestone once with -State all (#155) (#156)


### Documentation
- **delivery**: Herdr sidebar layout starts with the repo (#149) (#150)


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


### Features
- Port the unreleased apm-hub release/next (#881-#907)


## [1.0.0] — 2026-10-30

### Bug Fixes
- Dead runner link in working mode; vitest failures as CI annotations
- **test**: Group paths in the remaining tests; skill names in backticks stay bare
- **statusline**: Installed skill path stays flat (.claude/skills/context-statusline)


### Features
- Skills of GravionLabs/apm-hub 3.3.0, flat under skills/, installed with npx skills


### Refactoring
- Skills in group folders skills/<group>/<name>/



