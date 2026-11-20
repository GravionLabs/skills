# Roadmap

Order of work and release assignment for the open issues. Written 2026-10-30 after the move from GravionLabs/apm-hub (archived by #21). The generated blocks (between `roadmap:begin` and `roadmap:end` comments) are written by the `roadmap` skill and are not edited by hand; everything around them is hand-written.

<!-- roadmap:begin intro -->

Updated 2026-11-15. Last release `v4.3.1`.
<!-- roadmap:end -->

Work runs on `release/next`, the release PR into `main` is the human review point. A GitHub milestone is a release: it is named `M<n>` while open (also `M<n> <Topic>` for a topic) and renamed `M<n> (x.y.z)` or `M<n> <Topic> (x.y.z)` when released. The milestones of 1.0.2 to 1.6.0 below keep their legacy `x.y.z` titles; the `x.y.z` sections of this file are the releases. `/github-milestone current` shows the one being worked on, `list` all of them, `/roadmap` plans and writes the generated sections.

History: apm-hub 2.x and 3.x are in the [apm-hub roadmap](https://github.com/GravionLabs/apm-hub/blob/main/ROADMAP.md). A bare `#<n>` here is an issue of GravionLabs/skills.

## Where we are

<!-- roadmap:begin where -->

| Epic / Feature                                                                                | State                                                                              | Milestone     |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------- |
| #8 [Epic] Stack packages for more languages and frameworks                                    | open: #9                                                                           | not scheduled |
| #9 [Feature] Go, JVM and Swift stack packages and frontend framework detection                | open: #10, #11                                                                     | not scheduled |
| #190 [Feature] Budget check before large runs via tamias                                      | no open children                                                                   | not scheduled |
| #395 [Feature] read-only MCP server over progress events                                      | no open children                                                                   | not scheduled |
| #606 [Feature] deliver-loop -Objective schedules repository loops as a pool instead of rounds | no open children                                                                   | not scheduled |
| #611 [Feature] deliver scripts in TypeScript behind a host interface                          | open: #612, #613, #614, #615, #616, #617, #618, #619, #620, #621, #635, #636, #637 | not scheduled |

<!-- roadmap:end -->

Closed and therefore not listed above: Epic #1 (deliver issues through Claude Code workflows; Features #2, #3 in 1.0.2, #15 in 1.1.0), Feature #64 (ADRs and specs in the skills; PBIs #65–#68, #86, #87 in 1.2.0), Feature #104 (help for user-invoked skills, 1.3.0) and Epic #165 (documentation site, 1.4.0 and 1.5.0). Epic #8 waits for the decision on #10 (one `jvm` group or two).

## Done in 1.0.0 and 1.0.1

v1.0.0 is apm-hub 3.3.0 (released there as `v3.2.1`) plus its unreleased `release/next` (apm-hub#881–#907): `deliver` for several issues or a milestone, `Invoke-DeliverLoop.ps1`, planning without Task issues, `planner refine` with a definition of ready, Biome for Markdown and YAML, `Format-Changed.ps1` detection without `-Language`. The layout is `skills/<group>/<name>/`, installed with `npx skills`. v1.0.1 fixes the group paths of the ported tests.

<!-- roadmap:begin done 1.0.2 -->

## Done in 1.0.2

| Issue | Title                                                                                              |
| ----- | -------------------------------------------------------------------------------------------------- |
| #3    | [Feature] Lessons: repo-local lessons contract that skills read optionally                         |
| #4    | [PBI] chore(delivery): trial deliver in OpenCode                                                   |
| #5    | [PBI] chore(delivery): trial deliver in Copilot CLI                                                |
| #6    | [PBI] chore(delivery): retro over ten deliver runs                                                 |
| #7    | [PBI] test(shared): pin the extension map of Format-Changed detection                              |
| #14   | [PBI] feat: release v1.1.0 with the learning path                                                  |
| #19   | [PBI] chore: repository settings of GravionLabs/skills                                             |
| #20   | [PBI] chore: port the skill trigger evals                                                          |
| #21   | [PBI] chore: archive GravionLabs/apm-hub with a successor notice                                   |
| #23   | [PBI] feat(shared): lessons skill with contract and Get-Lessons.ps1 loading                        |
| #24   | [PBI] feat(shared): Get-Lessons.ps1 -Check validates lesson files                                  |
| #25   | [PBI] feat(shared): implementation, code-review and planner read lessons                           |
| #26   | [PBI] feat(delivery): skills-install names the !.agents/lessons/ gitignore exception               |
| #27   | [PBI] feat(delivery): retro drafts lessons with status proposed                                    |
| #28   | [PBI] feat(delivery): retro proposes retiring ineffective lessons                                  |
| #33   | [PBI] fix(shared): Format-Changed formats the .jsx, .css and .html files it detects as ts          |
| #37   | [PBI] feat(delivery): unattended deliver skips PBIs labelled interactive                           |
| #43   | [PBI] fix(shared): Get-Lessons -Check reports duplicate ids; retro separates draft errors          |
| #45   | [PBI] fix(delivery): Remove-PbiWorktrees lists a branch it fails to delete                         |
| #47   | [PBI] fix(delivery): deliver keeps the CI watch output unbuffered                                  |
| #48   | [PBI] docs(delivery): skills-install warns that a global skill copy can shadow the project install |
| #49   | [PBI] fix(delivery): the Copilot CLI allowlist of deliver names each git write subcommand          |
| #54   | [PBI] chore: link the repository skills as project skills for dogfooding                           |
| #55   | [PBI] fix(delivery): Remove-PbiWorktrees deletes merged branches with git branch -d first          |
| #56   | [PBI] fix: find the flaky tests of pnpm run check                                                  |
| #57   | [PBI] refactor(delivery): remove the frozen workflow.js                                            |

<!-- roadmap:end -->

Planned as 1.1.0; the release PR #70 carried no minor bump, so GitVersion tagged `v1.0.2` (worked around by #73, replaced by the Conventional Commit versioning of #102). Milestone 1.0.2 (renamed from 1.1.0): repository settings and ruleset on `release/next` (#19), trigger evals (#20), the lessons contract of Feature #3 (#23–#28, #43), the `deliver` trials in OpenCode (#4) and Copilot CLI (#5) with their fixes (#45, #47–#49), the retro (#6) and its follow-ups (#54–#57), the archive of GravionLabs/apm-hub (#21). Features #2, #3 and #18 are closed.

Retro #6 (2026-10-31, 14 `deliver` runs: 12 Claude Code, 1 OpenCode, 1 Copilot CLI): red CI at the end 0 %, fix rounds 0.21 per PBI, median time per PBI about 8 min, human wait ≈ 0 except the Copilot allowlist pause (fixed by #49); cost not measured (agentlens not installed). **Decision: `deliver/workflow.js` is deleted** (#57); plain subagents sufficed on all three harnesses. The Claude Code runs loaded an outdated global `deliver`, hence #54.

<!-- roadmap:begin done 1.1.0 -->

## Done in 1.1.0

| Issue | Title                                                                                            |
| ----- | ------------------------------------------------------------------------------------------------ |
| #12   | [PBI] feat(delivery): Invoke-DeliverLoop shows its log in a herdr or WezTerm split pane          |
| #13   | [PBI] feat(delivery): toggle the deliver log pane with a herdr key                               |
| #15   | [Feature] feat(delivery): herdr integration of deliver without a bus                             |
| #16   | [PBI] feat(delivery): deliver reports step, issue and PR as herdr pane tokens                    |
| #17   | [PBI] feat(delivery): herdr plugin to start and watch deliveries                                 |
| #72   | [PBI] build: move to Node.js 26                                                                  |
| #73   | [PBI] fix: GitVersion bumps the minor version on a release merge into main                       |
| #78   | [PBI] feat(deliver): merge into release/next without asking, end a milestone with the release PR |

<!-- roadmap:end -->

GitVersion bumps the minor version on a release merge into `main` (#73; since #101 and #102 the bump comes from the Conventional Commits, GravionLabs/ci#107), Node.js 26 (#72), `deliver` merges into `release/next` without asking (#78), the herdr integration of Feature #15: pane tokens (#16), the log pane of `Invoke-DeliverLoop` (#12) and its herdr key (#13). The herdr plugin of #17 moved to [GravionLabs/herdr-plugins](https://github.com/GravionLabs/herdr-plugins): GravionLabs/herdr-plugins#3 (`deliver-starter`), #5 (`agent-notify`), #22 (`deliver-view`) and #23 (`deliver-log`) there build on #16 and #13 here.

<!-- roadmap:begin done 1.2.0 -->

## Done in 1.2.0

| Issue | Title                                                                                |
| ----- | ------------------------------------------------------------------------------------ |
| #53   | [PBI] feat(deliver): write the review result to a file                               |
| #61   | [PBI] feat(dotnet): dotnet-aspire skill for local orchestration                      |
| #65   | [PBI] feat(shared): adr skill and the governance config key                          |
| #66   | [PBI] feat(shared): spec rules in implementation                                     |
| #67   | [PBI] feat(shared): code-review checks the ADR and spec rules                        |
| #68   | [PBI] feat(shared): detect-techstack reports ADRs, specs and governance              |
| #86   | [PBI] feat(delivery): planner applies the ADR and spec rules                         |
| #87   | [PBI] feat(delivery): deliver handles decision PBIs and spec notes                   |
| #97   | [Bug] fix: deliver loses the implementer notes, spec notes never reach review and PR |
| #98   | [Bug] fix: Get-GovernanceMatches diffs HEAD instead of the reviewed branch           |
| #99   | [Bug] fix: governance spec check treats files like latest.ts as tests                |
| #100  | [PBI] feat(delivery): deliver reviews release/next with Opus before the release PR   |
| #101  | [PBI] refactor(github-release): finish derives the bump from Conventional Commits    |
| #102  | [PBI] chore(versioning): adopt Conventional Commit versioning                        |
| #103  | [Bug] fix: deliver must select PBIs and bugs                                         |
| #112  | [PBI] docs: overview, roadmap and governance page for 1.2.0                          |
| #113  | [PBI] feat(github): github-milestone skill shows the current and all milestones      |
| #115  | [PBI] ci: drop the hourly project-needs sync, ci syncs nightly                       |
| #117  | [PBI] perf(github): move hot gh reads and CI polling off GraphQL                     |
| #130  | [Bug] fix: standalone issue merges into main with --squash                           |
| #131  | [Bug] fix: release review runs governance on the wrong diff without waivers          |

<!-- roadmap:end -->

Review file, Aspire, ADRs and specs. `release/next` was cut from `v1.1.0`; release PR #96. Notes: #53 is read by GravionLabs/herdr-plugins#4 (`review-popup`); #65 defines the `governance` key names read by GravionLabs/ci#94 and ci#95; #65–#68, #86 and #87 are Feature #64; #97–#99 were found while delivering #64; #100 is described in [delivery](site/delivery.md#release-review); #102 belongs to GravionLabs/ci#107 and ci#108 (ci v1.4.0). Also in the milestone: #112 (these docs) and #115 (drop the hourly project-needs sync). How the ADR and spec rules work together: [ADRs and specs](site/usage/governance.md).

<!-- roadmap:begin done 1.3.0 -->

## Done in 1.3.0

| Issue | Title                                                                              |
| ----- | ---------------------------------------------------------------------------------- |
| #104  | [Feature] feat: help for user-invoked skills (/<skill> help)                       |
| #105  | [PBI] feat(skill-tooling): help convention and test helper for user-invoked skills |
| #106  | [PBI] feat(delivery): /deliver help from references/help.md                        |
| #107  | [PBI] feat(delivery): /planner help from references/help.md                        |
| #108  | [PBI] feat(delivery): /skills-install help from references/help.md                 |
| #109  | [PBI] feat(github): /github-release help from references/help.md                   |
| #110  | [PBI] feat(delivery): /retro help from references/help.md                          |
| #111  | [PBI] feat(statusline): /context-statusline help from references/help.md           |
| #126  | [PBI] perf: measure the GraphQL share of a /deliver run after #117                 |
| #127  | [PBI] perf(delivery): read milestone issues in one batched REST call               |
| #133  | [Bug] fix(ci): recreate release/next after the release                             |
| #136  | [PBI] feat(github): github-pull-request copies the skip-adr label onto the PR      |
| #137  | [PBI] fix(delivery): release review round-3 pause is recorded and not repeated     |
| #149  | [PBI] docs(deliver): sidebar layout "repo first" in references/herdr.md            |
| #155  | [Bug] fix: deliver step 9 reads the round-3 pause marker from an open-only list    |

<!-- roadmap:end -->

Help for user-invoked skills: #105 sets the help convention and the test helper; #106–#111 add `references/help.md` to `deliver`, `planner`, `skills-install`, `github-release`, `retro` and `context-statusline`.

<!-- roadmap:begin done 1.4.0 -->

## Done in 1.4.0

| Issue | Title                                                                                    |
| ----- | ---------------------------------------------------------------------------------------- |
| #71   | [PBI] ci: adopt the bundled pr-checks.yml                                                |
| #114  | [PBI] ci: follow GravionLabs/ci on the major tag v1                                      |
| #151  | [PBI] test: detect-techstack test within the 15 s budget                                 |
| #152  | [PBI] test: deliver-loop test within the 15 s budget                                     |
| #162  | [PBI] feat(site): logo and favicon for the documentation site                            |
| #163  | [PBI] docs(site): remove apm-hub leftovers from the site package and skills concept page |
| #166  | [Feature] Restructure the site navigation                                                |
| #167  | [Feature] Workflow guides for planner and deliver                                        |
| #169  | [Feature] Concepts and reference pages                                                   |
| #170  | [PBI] docs(site): reorder the sidebar, guides before concepts                            |
| #171  | [PBI] docs(site): quick start page on the site                                           |
| #172  | [PBI] docs: guide for planning an issue with planner and grill-me                        |
| #173  | [PBI] docs: step-by-step guide for /deliver                                              |
| #174  | [PBI] docs: split common workflows into stack setup, manual issue and bug-fix guides     |
| #175  | [PBI] docs: guide for releasing a milestone, including the release/next ruleset          |
| #176  | [PBI] docs: guide for learning from runs with retro and lessons                          |
| #178  | [PBI] docs: concept pages for the issue model and skill composition                      |
| #179  | [PBI] docs: troubleshooting page                                                         |
| #181  | [PBI] feat(retro): flow diagram of the agent calls of a run                              |

<!-- roadmap:end -->

<!-- roadmap:begin done 1.5.0 -->

## Done in 1.5.0

| Issue | Title                                                                            |
| ----- | -------------------------------------------------------------------------------- |
| #165  | [Epic] Documentation site that guides users from install to delivery             |
| #168  | [Feature] herdr integration page                                                 |
| #177  | [PBI] docs: herdr page with the GravionLabs herdr plugins                        |
| #186  | [PBI] feat(delivery): Invoke-DeliverLoop.ps1 supports -Harness copilot           |
| #187  | [PBI] feat(delivery): deliver-loop shell shim offered by skills-install          |
| #191  | [PBI] feat(delivery): deliver loop reports its lifecycle state to herdr          |
| #193  | [PBI] feat(delivery): deliver loop colors its console output, log pane is opt-in |
| #201  | [Bug] fix(site): dev server shows a blank page                                   |
| #202  | [Bug] fix(deliver): loop console output is cut at 120 characters and uncolored   |
| #205  | [PBI] feat(statusline): context-statusline installs a context warning hook       |
| #206  | [PBI] feat(github): github-milestone closes a milestone after its release tag    |
| #207  | [Feature] Release routine closes and opens milestones through skills             |
| #216  | [Bug] fix: merge main (v1.4.1 hotfixes #201, #202) back into release/next        |
| #219  | [PBI] docs: guides and AGENTS.md mention the loop features of 1.5.0              |

<!-- roadmap:end -->

Herdr and the deliver loop, released as `v1.5.0` on 2026-11-03. The release routine of Feature #207 closes the milestone and opens the next one (#206 in 1.5.0, #223, #226 and #236 in 1.6.0).

<!-- Generated sections are inserted at the two slots below by `scripts/New-Roadmap.ps1`:
     "Done in M<n> (x.y.z)" (one per closed milestone, with its issue table) and one plan section per open M<n>
     (table: order, issue, title, size, depends on / decision). -->

<!-- roadmap:begin done 1.6.0 -->

## Done in 1.6.0

| Issue | Title                                                                                                     |
| ----- | --------------------------------------------------------------------------------------------------------- |
| #220  | [PBI] fix(delivery): verify the Copilot harness and the Copilot context hook against a live Copilot CLI   |
| #221  | [PBI] fix(delivery): deliver-loop shim and herdr state verified against a live herdr, quoting gaps closed |
| #222  | [PBI] fix(github): github-milestone close validates -MoveTo first and covers its failure paths            |
| #223  | [PBI] feat(github): github-release defines the back-merge of main into release/next                       |
| #224  | [PBI] fix(delivery): read-only reviewers, PR skill reads the pushed branch, delivery tests under 10 s     |
| #226  | [PBI] docs: release routine creates the next milestone before close --move-to                             |
| #227  | [Bug] fix(delivery): deliver-loop shim runs in the current directory instead of the repository root       |
| #228  | [PBI] docs: one herdr sidebar layout instead of two                                                       |
| #229  | [PBI] docs: stale loop and milestone wording in AGENTS.md, Invoke-DeliverLoop.ps1 and docs/delivery.md    |
| #233  | [Feature] Numbered milestones M<n>, version added on close                                                |
| #234  | [PBI] feat(github): milestones M<n> and M<n> (x.y.z), close renames                                       |
| #235  | [PBI] feat(delivery): deliver and loop work with M<n> milestones                                          |
| #236  | [PBI] feat(github): release routine closes M<n> and creates the next                                      |
| #241  | [Feature] roadmap skill plans releases and keeps ROADMAP.md                                               |
| #242  | [PBI] feat(github): github-milestone rename mode for legacy x.y.z titles                                  |
| #243  | [PBI] docs: migrating legacy x.y.z milestones to M<n>, tamias as example                                  |
| #244  | [PBI] feat(delivery): roadmap skill skeleton and Get-RoadmapState.ps1                                     |
| #245  | [PBI] feat(delivery): roadmap proposes M<n> assignment and sets milestones after approval                 |
| #246  | [PBI] feat(delivery): roadmap writes and updates ROADMAP.md after approval                                |
| #247  | [PBI] feat(delivery): roadmap help, marketplace entry, tables, trigger eval, guide                        |
| #248  | [PBI] docs: refresh ROADMAP.md to M<n> and 1.6.0 with the roadmap skill                                   |
| #249  | [PBI] feat(github): milestones accept a topic name, M<n> <Topic> (x.y.z)                                  |
| #255  | [PBI] feat(github): insert a milestone between M<n> and M<n+1> (sub-numbers, insert command)              |
| #270  | [Bug] fix(docs): ROADMAP.md is not reproducible by the roadmap skill                                      |
| #272  | [Bug] fix(delivery): roadmap state keeps the repository of a foreign blocker                              |
| #273  | [PBI] refactor(ng): rename skill ng-ag-grid-developer to ng-ag-grid                                       |
| #276  | [Bug] fix(delivery): roadmap scripts cannot find github-milestone in the installed layout                 |

<!-- roadmap:end -->

<!-- roadmap:begin done M001 -->

## Done in M001

| Issue | Title                                                                                 |
| ----- | ------------------------------------------------------------------------------------- |
| #250  | [PBI] chore: migrate the milestones of this repository to M<n>                        |
| #278  | [Bug] fix: skills-install cannot update installed skills or pick up new group members |
| #285  | [Bug] fix: skills-install -Update skips the update when npx skills check exits 1      |
| #286  | [Bug] fix: skills-install -Update hides a failing newMembers child process            |
| #289  | [PBI] feat(statusline): context warning threshold follows the context window size     |

<!-- roadmap:end -->

<!-- roadmap:begin done M002 -->

## Done in M002 (2.2.0)

| Issue | Title                                                                                    |
| ----- | ---------------------------------------------------------------------------------------- |
| #290  | [Feature] skill-manage: install and update in one skill, skills-install becomes obsolete |
| #291  | [PBI] feat(delivery): skill-manage with install and update                               |
| #292  | [PBI] feat(obsolete): group obsolete with skills-install as a forwarder                  |
| #293  | [PBI] docs: README, AGENTS and docs name skill-manage                                    |

<!-- roadmap:end -->

<!-- roadmap:begin done M003 -->

## Done in M003

No issues listed.
<!-- roadmap:end -->

<!-- roadmap:begin done M004 -->

## Done in M004 (3.0.0)

| Issue | Title                                                                            |
| ----- | -------------------------------------------------------------------------------- |
| #299  | [PBI] refactor(delivery): rename skill-manage to skills-manage                   |
| #302  | [PBI] refactor(skills): remove the obsolete group (skills-install, skill-manage) |

<!-- roadmap:end -->

<!-- roadmap:begin done M005 -->

## Done in M005 (3.1.0)

| Issue | Title                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------- |
| #232  | [PBI] feat(delivery): write review findings in poimen's findings.json format                                  |
| #305  | [Feature] project-setup: repo config for the detected stack (format, lint, editorconfig, governance, editors) |
| #306  | [PBI] feat(shared): project-setup with format per language and .editorconfig                                  |
| #307  | [PBI] feat(shared): lint key in the project config, runner and project-setup choice                           |
| #308  | [PBI] feat(shared): project-setup proposes the governance key                                                 |
| #309  | [PBI] feat(shared): project-setup adds .gitattributes, .gitignore and pre-commit hooks                        |
| #310  | [PBI] feat(shared): project-setup writes VS Code settings, tasks and launch configs                           |
| #311  | [PBI] feat(delivery): skills-manage offers project-setup after an install                                     |
| #312  | [Feature] project-setup: editor configs for VS Code, Zed and JetBrains                                        |
| #313  | [PBI] feat(shared): project-setup writes Zed settings, tasks and debug configs                                |
| #314  | [PBI] feat(shared): project-setup writes JetBrains shared run configurations                                  |
| #319  | [Feature] deliver: fewer interventions in parallel milestone runs                                             |
| #320  | [PBI] feat(delivery): status block after each PBI and deliver status                                          |
| #321  | [PBI] feat(delivery): interactive milestone run as a thin control session over the loop                       |
| #322  | [PBI] feat(github): release finish closes the milestone and checks the version after the merge                |
| #323  | [PBI] feat(delivery): preflight for repo skills, allowlist and stale worktrees                                |
| #324  | [PBI] feat(delivery): feedback during a run becomes issues in the milestone                                   |
| #325  | [PBI] feat(delivery): tier and model per PBI visible in select, status and loop                               |
| #327  | [PBI] feat(delivery): milestones hold PBIs and Bugs, Features only when complete, Epics never                 |
| #329  | [PBI] feat(delivery): deliver loop reports milestone progress, status.json and backend tokens                 |
| #331  | [PBI] refactor(delivery): terminal backend adapter for herdr and poimen in the deliver scripts                |
| #332  | [PBI] feat(delivery): JSON schema and fixtures for the deliver loop status.json                               |
| #346  | [Bug] fix: paused PBIs are counted as delivered by the deliver loop                                           |
| #347  | [Bug] fix: milestone progress counts Features and Epics, not the stop-rule set                                |
| #348  | [Bug] fix: control session pins -Model and disables the per-tier model                                        |
| #349  | [Bug] fix: docs still name sonnet as the loop -Model default                                                  |
| #350  | [Bug] fix: poimen branch of TerminalBackend uses guessed poimen-server report options                         |
| #356  | [Bug] fix: permissions.md lists poimen-server report only for herdr panes                                     |
| #357  | [Bug] fix: status schema does not describe closed and total as PBIs and Bugs only                             |
| #358  | [Bug] fix: deliver-preflight test is flaky under parallel load                                                |
| #359  | [Bug] fix: AGENTS.md repeats the Test-DeliverPreflight sentence in the delivery row                           |
| #360  | [Bug] fix: control session does not handle the loop result max reached                                        |
| #366  | [Bug] fix: deliver-preflight test still times out under parallel load                                         |

<!-- roadmap:end -->

<!-- roadmap:begin done M006 -->

## Done in M006 (3.2.0)

| Issue | Title                                                                                                                    |
| ----- | ------------------------------------------------------------------------------------------------------------------------ |
| #369  | [PBI] feat(delivery): progress event schema with tone and the Report-Progress emitter                                    |
| #370  | [PBI] feat(delivery): ConvertFrom-ProgressEvents reducer with run-state schema and paired fixtures                       |
| #371  | [PBI] feat(delivery): terminal sink in Report-Progress with tokens, agent state and deliver_tone                         |
| #372  | [PBI] refactor(delivery): loop writes run events and status.json from the projection                                     |
| #373  | [PBI] feat(delivery): deliver reports every progress line through Report-Progress in any backend                         |
| #374  | [PBI] refactor(delivery): console, ansi log and notifications from events, progress-line regex removed                   |
| #375  | [PBI] feat(delivery): retention for event files and stream recordings                                                    |
| #377  | [PBI] feat(delivery): release-test label, always the last item of a milestone, cuts the RC                               |
| #378  | [PBI] feat(delivery): step 9 cuts the RC and opens the release PR without waiting for the RC test                        |
| #379  | [PBI] feat(github-milestone): create the release-test issue with the milestone                                           |
| #381  | [PBI] docs(adr): ADR 0001 agent progress events                                                                          |
| #382  | [PBI] docs(github-release): issues close on merge into release/next                                                      |
| #397  | [Bug] fix: a nested harness session ends the loop's run early with its own run.finished                                  |
| #398  | [Bug] fix: release-test PBI is delivered as work before step 9, so the RC is never cut first                             |
| #399  | [Bug] fix: olderReleaseTests also includes the release-test issues of newer milestones                                   |
| #400  | [Bug] fix: nothing emits the attention kinds pr_opened, review_fix and ci_red                                            |
| #401  | [Bug] fix: an interactive session's run.started records a pid that has already exited                                    |
| #402  | [Bug] fix: release-test rule in milestones.md says the gate is not yet implemented                                       |
| #409  | [Bug] fix: finish looks up the release-test issue by exact milestone title, topic milestones skip the RC gate            |
| #411  | [Bug] fix: a nested harness session's run.started is appended to the loop's run and a nested run.finished is not stopped |
| #412  | [Bug] fix: release-test rule in milestones.md still says deliver selects it as the last open item                        |

<!-- roadmap:end -->

<!-- roadmap:begin done M007 -->

## Done in M007 (3.3.0)

| Issue | Title                                                                                         |
| ----- | --------------------------------------------------------------------------------------------- |
| #414  | [PBI] test(delivery): token fixtures pair events with the tokens and agent state of a display |
| #415  | [PBI] feat(delivery): Get-RunState.ps1 lists runs, folds one and tails its events             |
| #416  | [PBI] feat(delivery): terminal sink behind DELIVER_TERMINAL_SINK, marked deprecated           |
| #420  | [PBI] docs(adr): ADR 0002 displays read the progress events                                   |
| #425  | [PBI] feat(github): add the github-project skill from GravionLabs/ci                          |
| #428  | [Bug] fix: AGENTS.md says github-project is not in this repository                            |
| #429  | [Bug] fix: github-project live tests exceed the time budget and hit the worker timeout        |

<!-- roadmap:end -->

<!-- roadmap:begin done M008 -->

## Done in M008 (3.4.0)

| Issue | Title                                                                                                          |
| ----- | -------------------------------------------------------------------------------------------------------------- |
| #433  | [PBI] feat: zero-padded milestone numbers in github-milestone                                                  |
| #434  | [PBI] feat: renumber mode migrates existing milestones                                                         |
| #435  | [PBI] feat: padded milestone titles in roadmap, release and github-project scripts                             |
| #436  | [PBI] docs: M<nnn> milestone format in skills and guides                                                       |
| #438  | [PBI] fix: sub-issues from another repository count as outside the milestone                                   |
| #439  | [PBI] feat: github-milestone assign mode enforces the milestone rule                                           |
| #440  | [PBI] docs: set milestones only through github-milestone assign                                                |
| #441  | [PBI] refactor(delivery): drop the deliver-loop.ansi.log                                                       |
| #446  | [Bug] fix(delivery): Get-DeliverStatus.ps1 does not find github-milestone in an installed layout               |
| #447  | [Bug] fix: deliver preflight asks for js-implementation and js-test that no group installs                     |
| #451  | [PBI] docs(adr): skills writes agent-events core plus a deliver profile                                        |
| #464  | [Bug] fix(roadmap): milestone rule is checked per target, not over the whole assignment                        |
| #465  | [Bug] fix(github-milestone): assign dry run on a missing milestone violates the schema                         |
| #466  | [Bug] fix(roadmap): New-Roadmap duplicates sections after renumber                                             |
| #467  | [Bug] fix(docs): ADR 0003 must supersede ADR 0002 in part                                                      |
| #468  | [Bug] fix(deliver): one milestone key form in docs, schema and state files                                     |
| #469  | [Bug] fix(docs): github-milestone modes renumber and assign missing from AGENTS.md, SKILL.md and release guide |

<!-- roadmap:end -->

<!-- roadmap:begin done M009 -->

## Done in M009 (4.0.0)

| Issue | Title                                                                                                  |
| ----- | ------------------------------------------------------------------------------------------------------ |
| #376  | [PBI] refactor(delivery): remove status.json, its writer and the file contract                         |
| #460  | [Bug] fix: 8 deliver-loop LogPane/herdr tests fail locally on a clean release/next                     |
| #473  | [Feature] Stop a running deliver loop on request                                                       |
| #474  | [PBI] feat(deliver): deliver-loop stops before the next PBI on a stop request                          |
| #475  | [PBI] feat(deliver): deliver-loop stop requests a stop of the running loop                             |
| #476  | [PBI] feat(deliver): deliver-loop stop --now ends the iteration after the current step                 |
| #480  | [PBI] feat(deliver): merge by auto-merge instead of watching the checks                                |
| #481  | [PBI] feat(deliver): pick up PRs waiting for auto-merge in select                                      |
| #482  | [PBI] ci: run tests without coverage in two shards                                                     |
| #488  | [Bug] fix(deliver): loop logs an iteration under the first ready PBI, not the one the session delivers |
| #490  | [PBI] test: deliver-loop test files stay within the 15 s budget                                        |
| #492  | [PBI] feat: github-pages skill for a site/ on GitHub Pages                                             |
| #493  | [PBI] refactor: move the public docs from docs/ to site/                                               |
| #494  | [PBI] refactor: pages.yml uses the ci VitePress workflow                                               |
| #504  | [PBI] docs(github-issue): the RC of a desktop app installs side by side                                |

<!-- roadmap:end -->

<!-- roadmap:begin done M010 -->

## Done in M010 (4.1.0)

| Issue | Title                                                                                                   |
| ----- | ------------------------------------------------------------------------------------------------------- |
| #417  | [PBI] refactor(delivery): remove the terminal sink, the owner rule and the token functions              |
| #461  | [Bug] fix(deliver): loop sets no wait ceiling for claude and a long subagent is killed after 10 minutes |
| #462  | [Bug] fix(deliver): Get-DeliverStatus.ps1 cannot find Get-Milestones.ps1 in a global install            |
| #463  | [Bug] fix(deliver): a nested PBI session's run.finished sets the loop result to done                    |
| #506  | [PBI] fix(github-release): recognize the local path of release-branch.yml                               |
| #507  | [PBI] feat(shared): test key in the project config and a runner that does not guess the test tool       |

<!-- roadmap:end -->

<!-- roadmap:begin done M011 -->

## Done in M011 (4.1.3)

| Issue | Title                                                                                                 |
| ----- | ----------------------------------------------------------------------------------------------------- |
| #450  | [Feature] agent-events: skills writes the general core plus a deliver profile                         |
| #452  | [PBI] refactor(deliver): emit agent-events core plus deliver profile                                  |
| #511  | [Bug] fix(deliver): delivered[].prUrl falls back to the issue URL                                     |
| #517  | [Bug] fix(deliver): a control session leaves an empty run next to the loop run                        |
| #524  | [PBI] chore: back-merge main into release/next                                                        |
| #528  | [Bug] fix(github-release): merging the release PR deletes release/next and retargets open PRs to main |
| #529  | [Bug] fix(test): the prUrl null case of #511 exists twice                                             |

<!-- roadmap:end -->

<!-- roadmap:begin done M012 -->

## Done in M012 (4.2.0)

| Issue | Title                                                                                      |
| ----- | ------------------------------------------------------------------------------------------ |
| #531  | [Feature] Objectives: Konventionen, Status und Planung über Repos                          |
| #533  | [PBI] docs(adr): ADR 0004 Objectives coordinate milestones across repositories             |
| #534  | [PBI] chore: create the private coordination repository GravionLabs/telos                  |
| #535  | [PBI] feat(github-issue): the [Objective] level above Epic                                 |
| #536  | [PBI] fix(github-issue): read cross-repository blocked-by links with their repository      |
| #537  | [PBI] feat(deliver): label contract-change when a PR touches contracts.paths               |
| #538  | [PBI] feat(deliver): Get-ObjectiveStatus.ps1 reads an objective across repositories (JSON) |
| #539  | [PBI] feat(deliver): Get-ObjectiveStatus -Text status block with gates                     |
| #540  | [PBI] test: acceptance of Get-ObjectiveStatus against telos#1 (Console/Remote plan)        |
| #541  | [PBI] feat(planner): plan an objective into Features of the target repositories            |
| #542  | [PBI] feat(planner): refine an objective checks repos, release edges and criteria          |
| #559  | [Bug] fix: Get-ObjectiveStatus ignores Requires lines on PBIs and Bugs                     |

<!-- roadmap:end -->

<!-- roadmap:begin done M013 -->

## Done in M013 (4.3.0)

| Issue | Title                                                                                   |
| ----- | --------------------------------------------------------------------------------------- |
| #532  | [Feature] Objectives: Orchestrator deliver-loop -Objective                              |
| #543  | [PBI] feat(deliver): deliver-loop -Objective runs rounds over the ready repositories    |
| #544  | [PBI] feat(deliver): runner marker, heartbeat and takeover for an objective             |
| #545  | [PBI] feat(deliver): pause downstream on contract-change and trigger the RC             |
| #546  | [PBI] feat(deliver): -Context file with upstream PRs for the fix subagent               |
| #547  | [PBI] feat(deliver): interactive /deliver --objective control session                   |
| #548  | [PBI] feat(deliver): deliver.parallel runs several loops across repositories            |
| #563  | [PBI] feat(implementation): forbid background persistence in apps                       |
| #570  | [Bug] fix: contract-change rule reads the label from the PR, deliver sets it on the PBI |

<!-- roadmap:end -->

<!-- roadmap:begin done M014 -->

## Done in M014 (4.3.1)

| Issue | Title                                                                                               |
| ----- | --------------------------------------------------------------------------------------------------- |
| #572  | [Bug] fix: takeover-during-a-round runner test is flaky                                             |
| #573  | [Bug] fix: heartbeat PATCH can overwrite a takeover -Force                                          |
| #574  | [Bug] fix: validate owner/repo of Requires: lines before building checkout paths                    |
| #575  | [Bug] fix: objective loop shows wrong status for repo loops and misses the acceptance-criteria gate |
| #576  | [Bug] fix: deliver-loop stop has no defined effect on an objective run                              |
| #577  | [PBI] perf(deliver): read only new closed PRs per objective round                                   |
| #578  | [PBI] fix(deliver): objective rc trigger without preflight and stale context.md                     |
| #579  | [PBI] docs(implementation): one wording for the background-persistence rule                         |
| #580  | [PBI] test(deliver): cut deliver-loop-objective-rules tests below the 15 s budget                   |
| #584  | [Feature] Objectives: fixes after the first orchestrator runs                                       |

<!-- roadmap:end -->

<!-- roadmap:slot done -->

Numbered milestones and the roadmap skill. Delivered on `release/next`: the release routine closes and opens milestones (#222, #223, #226, #236), `github-milestone` with `M<n>`, `M<n> <Topic>`, rename and insert (#234, #242, #249, #255, #229 docs), `deliver` and the loop with `M<n>` (#235), the `roadmap` skill (#244–#248), the migration guide (#243), and fixes of the Copilot harness, the shim and the read-only reviewers (#220, #221, #224, #227, #228). Features #233 and #241 have all their PBIs delivered and are closed with the release.

<!-- roadmap:begin plan M015 -->

## M015

Progress: 50 % (9 of 18 issues closed).

| Order | Issue | Title                                                                                                           | Size | Depends on / decision |
| ----- | ----- | --------------------------------------------------------------------------------------------------------------- | ---- | --------------------- |
| 1     | #601  | [PBI] fix(deliver): issue titles and milestone url in event subjects                                            | S    |                       |
| 2     | #603  | [PBI] fix(deliver): a partial run result is succeeded with a warning tone                                       | S    |                       |
| 3     | #604  | [Bug] fix: objective status shows a repository as ready when its loop can only skip interactive or claimed PBIs | ?    |                       |
| 4     | #605  | [Bug] fix: deliver-loop reports no progress when the PR merges by auto-merge right after the session            | ?    |                       |
| 5     | #607  | [PBI] perf(deliver): reuse and parallelize the objective context file                                           | ?    |                       |
| 6     | #608  | [PBI] feat(deliver): repair an existing PR of the own branch instead of pausing                                 | ?    |                       |
| 7     | #633  | [PBI] fix(deliver): preflight and loop start although release/next is missing                                   | S    |                       |
| 8     | #634  | [Bug] fix(deliver): the loop sends desktop notifications inside a poimen terminal                               | ?    |                       |

<!-- roadmap:end -->

<!-- roadmap:begin plan M016 -->

## M016

Progress: 0 % (0 of 6 issues closed).

| Order | Issue | Title                                                                                    | Size | Depends on / decision |
| ----- | ----- | ---------------------------------------------------------------------------------------- | ---- | --------------------- |
| 1     | #612  | [PBI] docs(adr): the deliver loop runs as TypeScript on Node behind a host interface     | S    |                       |
| 2     | #613  | [PBI] feat(deliver): loop core in TypeScript with arguments, GitHub state and stop rules | M    | blocked by #612       |
| 3     | #614  | [PBI] feat(deliver): LoopHost interface, process host and session record parsers         | M    | blocked by #612       |
| 4     | #615  | [PBI] feat(deliver): the TypeScript loop delivers a milestone end to end                 | L    | blocked by #613, #614 |
| 5     | #616  | [PBI] refactor(deliver): emitter, reducer and run state in TypeScript                    | L    | blocked by #612       |
| 6     | #617  | [PBI] feat(deliver): stop request in the TypeScript loop                                 | S    | blocked by #615       |

<!-- roadmap:end -->

<!-- roadmap:begin plan M017 -->

## M017

Progress: 0 % (0 of 7 issues closed).

| Order | Issue | Title                                                                      | Size | Depends on / decision       |
| ----- | ----- | -------------------------------------------------------------------------- | ---- | --------------------------- |
| 1     | #618  | [PBI] feat(deliver): objective mode in the TypeScript loop                 | L    | blocked by #615             |
| 2     | #619  | [PBI] feat(deliver): the TypeScript loop is the default                    | S    | blocked by #615, #618, #617 |
| 3     | #620  | [PBI] refactor(deliver): remove the PowerShell loop                        | S    | blocked by #619             |
| 4     | #621  | [PBI] refactor(deliver): merging and status scripts in TypeScript          | M    | blocked by #616             |
| 5     | #635  | [PBI] refactor(deliver): objective status in TypeScript                    | M    | blocked by #616, #618       |
| 6     | #636  | [PBI] refactor(deliver): preflight in TypeScript                           | M    | blocked by #616             |
| 7     | #637  | [PBI] refactor(deliver): contract check and worktree cleanup in TypeScript | S    | blocked by #616             |

<!-- roadmap:end -->

<!-- roadmap:slot plan -->

## Later

<!-- roadmap:begin later -->

| Issue | Title                                                                                                  | Why later                         |
| ----- | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| #10   | [PBI] feat(jvm): jvm package for Java and Kotlin with jvm-implementation and jvm-test                  | `needs-decision`                  |
| #11   | [PBI] feat(swift): swift package with swift-implementation and swift-test, detection via Package.swift | blocked by #10                    |
| #190  | [Feature] Budget check before large runs via tamias                                                    | no milestone                      |
| #395  | [Feature] read-only MCP server over progress events                                                    | no milestone                      |
| #581  | [PBI] feat(deliver): report the loop state with OSC 7501                                               | blocked by GravionLabs/poimen#681 |
| #599  | [PBI] feat(deliver): deliver.parallel defaults to 3 across repositories                                | `needs-decision`                  |
| #606  | [Feature] deliver-loop -Objective schedules repository loops as a pool instead of rounds               | no milestone                      |

<!-- roadmap:end -->

## Risks

- The git guardrails hook of apm-hub is uninstalled locally; `release/next` and `main` are protected by their rulesets only.
