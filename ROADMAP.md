# Roadmap

Order of work and release assignment for the open issues. Written 2026-10-30 after the move from GravionLabs/apm-hub (archived by #21). Last release `v1.0.1` (2026-10-30). Work runs on `release/next`, the release PR into `main` is the human review point; each release has a GitHub milestone of the same name.

History: apm-hub 2.x and 3.x are in the [apm-hub roadmap](https://github.com/GravionLabs/apm-hub/blob/main/ROADMAP.md). A bare `#<n>` here is an issue of GravionLabs/skills.

## Where we are

| Epic / Feature                                  | State                                   | Note                                                    |
| ----------------------------------------------- | --------------------------------------- | ------------------------------------------------------- |
| #1 deliver issues through Claude Code workflows | open for Features #2, #3, #15           | `deliver` shipped with apm-hub 3.2.1 and in v1.0.0 here |
| #2 deliver as a harness-neutral skill           | open: trials #4, #5, retro #6, tests #7 | the Claude Code trial (apm-hub#863) is done             |
| #3 lessons contract                             | refined, no PBIs yet                    | planned with `planner` before delivery                  |
| #15 herdr integration of deliver                | open: #16, #12, #13, #17                | not in 1.1.0                                            |
| #18 finish the move from apm-hub                | open: #19, #20, #21                     | repository settings first, `deliver` needs the ruleset  |
| #8 stack packages (Feature #9)                  | open: #10 (`needs-decision`), #11       | out of 1.1.0 until #10 is decided                       |

## Done in 1.0.0 and 1.0.1

v1.0.0 is apm-hub 3.3.0 (released there as `v3.2.1`) plus its unreleased `release/next` (apm-hub#881–#907): `deliver` for several issues or a milestone, `Invoke-DeliverLoop.ps1`, planning without Task issues, `planner refine` with a definition of ready, Biome for Markdown and YAML, `Format-Changed.ps1` detection without `-Language`. The layout is `skills/<group>/<name>/`, installed with `npx skills`. v1.0.1 fixes the group paths of the ported tests.

## 1.1.0 — learning path, trials and the end of the move

Milestone 1.1.0. `release/next` is cut from `v1.0.1`. Order: repository settings (#19, the ruleset is the gate of `deliver`), the test PBI #7, the trigger evals #20, the trials #4 and #5, the lessons PBIs of #3 (planned with `planner`), the archive of apm-hub #21, the retro #6 if ten runs are reached, then the release #14.

| Order | Issue | Title                                                                              | Size | Depends on / decision                                        |
| ----- | ----- | ---------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------ |
| 1     | #19   | repository settings: ruleset on `release/next`, secrets, Pages, project, milestone | S    | owner                                                        |
| 2     | #7    | pin the extension map of `Format-Changed.ps1` detection                            | S    | `needs-decision` label: answer or remove it before `deliver` |
| 3     | #20   | port the skill trigger evals                                                       | M    | —                                                            |
| 4     | #4    | trial `deliver` in OpenCode                                                        | S    | `opencode` CLI and a provider login                          |
| 4     | #5    | trial `deliver` in Copilot CLI                                                     | S    | —                                                            |
| 5     | #3    | lessons contract: split into PBIs with `planner`, then deliver them                | L    | scope and decisions in #3                                    |
| 6     | #21   | archive GravionLabs/apm-hub with a successor notice                                | S    | #19                                                          |
| 7     | #6    | retro over ten `deliver` runs; decides on `workflow.js`                            | S    | #4, #5; moves to 1.2.0 if ten runs are not reached           |
| 8     | #14   | release v1.1.0 with the learning path                                              | S    | #3; owner approves the release PR                            |

Feature #3 closes with its last PBI. Features #2 and #18 close when their PBIs are done; Epic #1 stays open for #15.

## Later

| Issue         | Title                                                     | Why later                                         |
| ------------- | --------------------------------------------------------- | ------------------------------------------------- |
| #16           | `deliver` reports step, issue and PR as herdr pane tokens | Feature #15 is the 1.2.0 candidate                |
| #12, #13, #17 | herdr log pane, key toggle and plugin                     | #12 and #17 need refinement; #13 ← #12, #17 ← #16 |
| #10           | jvm package for Java and Kotlin                           | `needs-decision`: one `jvm` group or two          |
| #11           | swift package                                             | blocked by #10                                    |

## Risks

- `GitVersion.yml` still says `next-version: 1.0.0`. `github-release` `finish` adds `+semver: minor` (apm-hub#881), so the release PR should be tagged `v1.1.0`; check the computed version before merging.
- Without the ruleset of #19, `deliver` warns and a red PR can be merged.
- #4 needs an OpenCode installation and provider login; it was skipped in apm-hub for that reason.
- #6 needs ten `deliver` runs across the harnesses; it can slip to 1.2.0 without blocking #14.
