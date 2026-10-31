# Roadmap

Order of work and release assignment for the open issues. Written 2026-10-30 after the move from GravionLabs/apm-hub (archived by #21). Last release `v1.0.2` (2026-10-31). Work runs on `release/next`, the release PR into `main` is the human review point; each release has a GitHub milestone of the same name.

History: apm-hub 2.x and 3.x are in the [apm-hub roadmap](https://github.com/GravionLabs/apm-hub/blob/main/ROADMAP.md). A bare `#<n>` here is an issue of GravionLabs/skills.

## Where we are

| Epic / Feature                                  | State                             | Note                              |
| ----------------------------------------------- | --------------------------------- | --------------------------------- |
| #1 deliver issues through Claude Code workflows | open for Feature #15              | Features #2 and #3 done in v1.0.2 |
| #15 herdr integration of deliver                | open: #16, #12, #13               | milestone 1.1.0                   |
| #8 stack packages (Feature #9)                  | open: #10 (`needs-decision`), #11 | out of 1.1.0 until #10 is decided |

## Done in 1.0.0 and 1.0.1

v1.0.0 is apm-hub 3.3.0 (released there as `v3.2.1`) plus its unreleased `release/next` (apm-hub#881–#907): `deliver` for several issues or a milestone, `Invoke-DeliverLoop.ps1`, planning without Task issues, `planner refine` with a definition of ready, Biome for Markdown and YAML, `Format-Changed.ps1` detection without `-Language`. The layout is `skills/<group>/<name>/`, installed with `npx skills`. v1.0.1 fixes the group paths of the ported tests.

## Done in 1.0.2

Planned as 1.1.0; the release PR #70 missed the `+semver: minor` commit, so GitVersion tagged `v1.0.2` (fixed by #73). Milestone 1.0.2 (renamed from 1.1.0): repository settings and ruleset on `release/next` (#19), trigger evals (#20), the lessons contract of Feature #3 (#23–#28, #43), the `deliver` trials in OpenCode (#4) and Copilot CLI (#5) with their fixes (#45, #47–#49), the retro (#6) and its follow-ups (#54–#57), the archive of GravionLabs/apm-hub (#21). Features #2, #3 and #18 are closed.

Retro #6 (2026-10-31, 14 `deliver` runs: 12 Claude Code, 1 OpenCode, 1 Copilot CLI): red CI at the end 0 %, fix rounds 0.21 per PBI, median time per PBI about 8 min, human wait ≈ 0 except the Copilot allowlist pause (fixed by #49); cost not measured (agentlens not installed). **Decision: `deliver/workflow.js` is deleted** (#57); plain subagents sufficed on all three harnesses. The Claude Code runs loaded an outdated global `deliver`, hence #54.

## 1.1.0 — herdr integration

Milestone 1.1.0 (renamed from 1.2.0). `release/next` is cut from `v1.0.2`.

| Order | Issue | Title                                                               | Size | Depends on / decision                        |
| ----- | ----- | ------------------------------------------------------------------- | ---- | -------------------------------------------- |
| 1     | #73   | GitVersion bumps the minor version on a release merge into `main`   | S    | — (first, so the release is tagged `v1.1.0`) |
| 2     | #16   | `deliver` reports step, issue and PR as herdr pane tokens           | S    | Feature #15, refined                         |
| 2     | #12   | `Invoke-DeliverLoop` shows its log in a herdr or WezTerm split pane | S    | Feature #15, refined                         |
| 3     | #13   | toggle the `deliver` log pane with a herdr key                      | S    | #12                                          |

Feature #15 and Epic #1 close with #16, #12 and #13. The herdr plugin of #17 moved to [GravionLabs/herdr-plugins](https://github.com/GravionLabs/herdr-plugins): GravionLabs/herdr-plugins#3 (`deliver-starter`), #5 (`agent-notify`), #22 (`deliver-view`) and #23 (`deliver-log`) there build on #16 and #13 here.

## Later

| Issue | Title                           | Why later                                |
| ----- | ------------------------------- | ---------------------------------------- |
| #10   | jvm package for Java and Kotlin | `needs-decision`: one `jvm` group or two |
| #11   | swift package                   | blocked by #10                           |

## Risks

- Until #73 is merged, a release merge into `main` counts a patch unless `github-release` `finish` commits `+semver: minor`; check the computed version before merging.
- The git guardrails hook of apm-hub is uninstalled locally; `release/next` and `main` are protected by their rulesets only.
