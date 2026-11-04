# Roadmap

Order of work and release assignment for the open issues. Written 2026-10-30 after the move from GravionLabs/apm-hub (archived by #21), updated 2026-11-04 with the `roadmap` skill. Last release `v1.5.0` (2026-11-03). Work runs on `release/next`, the release PR into `main` is the human review point. A GitHub milestone is a release: it is named `M<n>` while open (also `M<n> <Topic>` for a topic) and renamed `M<n> (x.y.z)` or `M<n> <Topic> (x.y.z)` when released. The milestones of 1.0.2 to 1.6.0 below keep their legacy `x.y.z` titles; the `x.y.z` sections of this file are the releases. `/github-milestone current` shows the one being worked on, `list` all of them, `/roadmap` plans and writes the generated sections.

History: apm-hub 2.x and 3.x are in the [apm-hub roadmap](https://github.com/GravionLabs/apm-hub/blob/main/ROADMAP.md). A bare `#<n>` here is an issue of GravionLabs/skills.

## Where we are

| Epic / Feature                                  | State                             | Note                                     |
| ----------------------------------------------- | --------------------------------- | ---------------------------------------- |
| #1 deliver issues through Claude Code workflows | all Features closed               | Features #2, #3 in v1.0.2, #15 in v1.1.0 |
| #8 stack packages (Feature #9)                  | open: #10 (`needs-decision`), #11 | not scheduled until #10 is decided       |
| #64 ADRs and specs in the skills                | closed                            | PBIs #65–#68, #86, #87 in 1.2.0          |
| #104 help for user-invoked skills               | open: #105–#111                   | milestone 1.3.0                          |

## Done in 1.0.0 and 1.0.1

v1.0.0 is apm-hub 3.3.0 (released there as `v3.2.1`) plus its unreleased `release/next` (apm-hub#881–#907): `deliver` for several issues or a milestone, `Invoke-DeliverLoop.ps1`, planning without Task issues, `planner refine` with a definition of ready, Biome for Markdown and YAML, `Format-Changed.ps1` detection without `-Language`. The layout is `skills/<group>/<name>/`, installed with `npx skills`. v1.0.1 fixes the group paths of the ported tests.

## Done in 1.0.2

Planned as 1.1.0; the release PR #70 carried no minor bump, so GitVersion tagged `v1.0.2` (worked around by #73, replaced by the Conventional Commit versioning of #102). Milestone 1.0.2 (renamed from 1.1.0): repository settings and ruleset on `release/next` (#19), trigger evals (#20), the lessons contract of Feature #3 (#23–#28, #43), the `deliver` trials in OpenCode (#4) and Copilot CLI (#5) with their fixes (#45, #47–#49), the retro (#6) and its follow-ups (#54–#57), the archive of GravionLabs/apm-hub (#21). Features #2, #3 and #18 are closed.

Retro #6 (2026-10-31, 14 `deliver` runs: 12 Claude Code, 1 OpenCode, 1 Copilot CLI): red CI at the end 0 %, fix rounds 0.21 per PBI, median time per PBI about 8 min, human wait ≈ 0 except the Copilot allowlist pause (fixed by #49); cost not measured (agentlens not installed). **Decision: `deliver/workflow.js` is deleted** (#57); plain subagents sufficed on all three harnesses. The Claude Code runs loaded an outdated global `deliver`, hence #54.

## Done in 1.1.0

Milestone 1.1.0: GitVersion bumps the minor version on a release merge into `main` (#73; since #101 and #102 the bump comes from the Conventional Commits, GravionLabs/ci#107), Node.js 26 (#72), `deliver` merges into `release/next` without asking (#78), the herdr integration of Feature #15: pane tokens (#16), the log pane of `Invoke-DeliverLoop` (#12) and its herdr key (#13). The herdr plugin of #17 moved to [GravionLabs/herdr-plugins](https://github.com/GravionLabs/herdr-plugins): GravionLabs/herdr-plugins#3 (`deliver-starter`), #5 (`agent-notify`), #22 (`deliver-view`) and #23 (`deliver-log`) there build on #16 and #13 here.

## 1.2.0 — review file, Aspire, ADRs and specs

Milestone 1.2.0, `release/next` cut from `v1.1.0`; release PR #96. Delivered:

| Issue   | Title                                                                                             | Note                                                            |
| ------- | ------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| #53     | `deliver` writes the review result to a file                                                      | GravionLabs/herdr-plugins#4 (`review-popup`) reads it           |
| #61     | `dotnet-aspire` skill                                                                             |                                                                 |
| #65     | `adr` skill and `governance` key                                                                  | Feature #64; the key names are read by GravionLabs/ci#94, ci#95 |
| #66     | spec rules in `implementation`                                                                    | Feature #64                                                     |
| #67     | `code-review` checks the ADR and spec rules                                                       | Feature #64                                                     |
| #68     | `detect-techstack` reports ADRs, specs and governance                                             | Feature #64                                                     |
| #86     | `planner` applies the ADR and spec rules                                                          | Feature #64                                                     |
| #87     | `deliver` handles decision PBIs and spec notes                                                    | Feature #64                                                     |
| #97–#99 | fixes: implementer notes in `deliver`, `Get-GovernanceMatches` base, test files in the spec check | found while delivering #64                                      |
| #100    | `deliver` reviews `release/next` with Opus before the release PR                                  | [delivery](docs/delivery.md#release-review)                     |
| #103    | `deliver` selects PBIs and Bugs                                                                   |                                                                 |
| #113    | `github-milestone` skill                                                                          |                                                                 |
| #117    | hot `gh` reads and CI polling over REST instead of GraphQL                                        |                                                                 |
| #101    | `github-release finish` derives the bump from Conventional Commits                                |                                                                 |
| #102    | Conventional Commit versioning and the PR title check                                             | GravionLabs/ci#107, ci#108 (ci v1.4.0)                          |

Also in the milestone: #112 (these docs) and #115 (drop the hourly project-needs sync). How the ADR and spec rules work together: [ADRs and specs](docs/usage/governance.md).

## 1.3.0 — help for user-invoked skills

Milestone 1.3.0: Feature #104, `/<skill> help` for the user-invoked skills. #105 sets the help convention and the test helper; #106–#111 add `references/help.md` to `deliver`, `planner`, `skills-install`, `github-release`, `retro` and `context-statusline`.

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

## 1.5.0 — herdr and the deliver loop

Milestone 1.5.0, released as `v1.5.0` on 2026-11-03. The milestone is still open on GitHub with two issues: Feature #207 (release routine closes and opens milestones; its PBIs #206, #223, #226 and #236 are done, the last in 1.6.0) and Epic #165 (documentation site, its Features #166–#169 are closed). Delivered (12 of 14 issues closed):

| Issue | Title                                                                            |
| ----- | -------------------------------------------------------------------------------- |
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
| #216  | [Bug] fix: merge main (v1.4.1 hotfixes #201, #202) back into release/next        |
| #219  | [PBI] docs: guides and AGENTS.md mention the loop features of 1.5.0              |

## 1.6.0 — numbered milestones and the roadmap skill

Milestone 1.6.0 (legacy title) is being delivered on `release/next`. Closed so far (20): the release routine closes and opens milestones (#222, #223, #226, #236), `github-milestone` with `M<n>`, `M<n> <Topic>` and rename (#234, #242, #249, #229 docs), `deliver` and the loop with `M<n>` (#235), the `roadmap` skill (#244–#247), the migration guide (#243), and fixes of the Copilot harness, the shim and the read-only reviewers (#220, #221, #224, #227, #228).

<!-- roadmap:begin plan 1.6.0 -->
## 1.6.0

Progress: 83 % (20 of 24 issues closed).

| Order | Issue | Title                                                                                        | Size | Depends on / decision |
| ----- | ----- | -------------------------------------------------------------------------------------------- | ---- | --------------------- |
| 1     | #248  | [PBI] docs: refresh ROADMAP.md to M<n> and 1.6.0 with the roadmap skill                      | ?    |                       |
| 2     | #255  | [PBI] feat(github): insert a milestone between M<n> and M<n+1> (sub-numbers, insert command) | ?    |                       |
<!-- roadmap:end -->

Open parents: Feature #233 (numbered milestones, open child #255) and Feature #241 (roadmap skill, open child #248).

## Later

| Issue | Title                           | Why later                                                                                                             |
| ----- | ------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| #10   | jvm package for Java and Kotlin | `needs-decision`: one `jvm` group or two                                                                              |
| #11   | swift package                   | blocked by #10                                                                                                        |
| #71   | adopt the bundled pr-checks.yml | no milestone; readiness is on: every PR closes an issue, also docs, roadmap and sync PRs; only release PRs are exempt |

## Risks

- The git guardrails hook of apm-hub is uninstalled locally; `release/next` and `main` are protected by their rulesets only.
