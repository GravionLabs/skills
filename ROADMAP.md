# Roadmap

Order of work and release assignment for the open issues. Written 2026-10-30 after the move from GravionLabs/apm-hub (archived by #21). The generated blocks (between `roadmap:begin` and `roadmap:end` comments) are written by the `roadmap` skill and are not edited by hand; everything around them is hand-written.

<!-- roadmap:begin intro -->
Updated 2026-11-04. Last release `v1.5.0`.
<!-- roadmap:end -->

Work runs on `release/next`, the release PR into `main` is the human review point. A GitHub milestone is a release: it is named `M<n>` while open (also `M<n> <Topic>` for a topic) and renamed `M<n> (x.y.z)` or `M<n> <Topic> (x.y.z)` when released. The milestones of 1.0.2 to 1.6.0 below keep their legacy `x.y.z` titles; the `x.y.z` sections of this file are the releases. `/github-milestone current` shows the one being worked on, `list` all of them, `/roadmap` plans and writes the generated sections.

History: apm-hub 2.x and 3.x are in the [apm-hub roadmap](https://github.com/GravionLabs/apm-hub/blob/main/ROADMAP.md). A bare `#<n>` here is an issue of GravionLabs/skills.

## Where we are

<!-- roadmap:begin where -->
| Epic / Feature                                                                 | State            | Milestone     |
| ------------------------------------------------------------------------------ | ---------------- | ------------- |
| #8 [Epic] Stack packages for more languages and frameworks                     | open: #9         | not scheduled |
| #9 [Feature] Go, JVM and Swift stack packages and frontend framework detection | open: #10, #11   | not scheduled |
| #190 [Feature] Budget check before large runs via tamias                       | no open children | not scheduled |
| #233 [Feature] Numbered milestones M<n>, version added on close                | no open children | 1.6.0         |
| #241 [Feature] roadmap skill plans releases and keeps ROADMAP.md               | no open children | 1.6.0         |
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

Review file, Aspire, ADRs and specs. `release/next` was cut from `v1.1.0`; release PR #96. Notes: #53 is read by GravionLabs/herdr-plugins#4 (`review-popup`); #65 defines the `governance` key names read by GravionLabs/ci#94 and ci#95; #65–#68, #86 and #87 are Feature #64; #97–#99 were found while delivering #64; #100 is described in [delivery](docs/delivery.md#release-review); #102 belongs to GravionLabs/ci#107 and ci#108 (ci v1.4.0). Also in the milestone: #112 (these docs) and #115 (drop the hourly project-needs sync). How the ADR and spec rules work together: [ADRs and specs](docs/usage/governance.md).

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

<!-- roadmap:slot done -->

<!-- roadmap:begin plan 1.6.0 -->
## 1.6.0

Progress: 93 % (25 of 27 issues closed).

| Order | Issue | Title                                                       | Size | Depends on / decision |
| ----- | ----- | ----------------------------------------------------------- | ---- | --------------------- |
| 1     | #233  | [Feature] Numbered milestones M<n>, version added on close  | ?    |                       |
| 2     | #241  | [Feature] roadmap skill plans releases and keeps ROADMAP.md | ?    |                       |
<!-- roadmap:end -->

Numbered milestones and the roadmap skill. Delivered on `release/next`: the release routine closes and opens milestones (#222, #223, #226, #236), `github-milestone` with `M<n>`, `M<n> <Topic>`, rename and insert (#234, #242, #249, #255, #229 docs), `deliver` and the loop with `M<n>` (#235), the `roadmap` skill (#244–#248), the migration guide (#243), and fixes of the Copilot harness, the shim and the read-only reviewers (#220, #221, #224, #227, #228). Features #233 and #241 have all their PBIs delivered and are closed with the release.

<!-- roadmap:slot plan -->

## Later

<!-- roadmap:begin later -->
| Issue | Title                                                                                                  | Why later                         |
| ----- | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| #10   | [PBI] feat(jvm): jvm package for Java and Kotlin with jvm-implementation and jvm-test                  | `needs-decision`                  |
| #11   | [PBI] feat(swift): swift package with swift-implementation and swift-test, detection via Package.swift | blocked by #10                    |
| #190  | [Feature] Budget check before large runs via tamias                                                    | no milestone                      |
| #231  | [Bug] fix(statusline): use %USERPROFILE% on Windows instead of ~ for hook and status line paths        | no milestone                      |
| #232  | [PBI] feat(delivery): write review findings in poimen's findings.json format                           | blocked by GravionLabs/poimen#246 |
| #250  | [PBI] chore: migrate the milestones of this repository to M<n>                                         | no milestone                      |
<!-- roadmap:end -->

## Risks

- The git guardrails hook of apm-hub is uninstalled locally; `release/next` and `main` are protected by their rulesets only.
