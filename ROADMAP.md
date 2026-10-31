# Roadmap

Order of work and release assignment for the open issues. Written 2026-10-30 after the move from GravionLabs/apm-hub (archived by #21). Last release `v1.0.1` (2026-10-30). Work runs on `release/next`, the release PR into `main` is the human review point; each release has a GitHub milestone of the same name.

History: apm-hub 2.x and 3.x are in the [apm-hub roadmap](https://github.com/GravionLabs/apm-hub/blob/main/ROADMAP.md). A bare `#<n>` here is an issue of GravionLabs/skills.

## Where we are

| Epic / Feature                                  | State                             | Note                                                    |
| ----------------------------------------------- | --------------------------------- | ------------------------------------------------------- |
| #1 deliver issues through Claude Code workflows | open for Features #2, #3, #15     | `deliver` shipped with apm-hub 3.2.1 and in v1.0.0 here |
| #2 deliver as a harness-neutral skill           | open: retro follow-ups #54–#57    | trials #4, #5 and retro #6 done                         |
| #3 lessons contract                             | open: PBIs #23–#28                | planned with `planner` on 2026-10-30                    |
| #15 herdr integration of deliver                | open: #16, #12, #13, #17          | milestone 1.2.0                                         |
| #18 finish the move from apm-hub                | open: #19, #20, #21               | repository settings first, `deliver` needs the ruleset  |
| #8 stack packages (Feature #9)                  | open: #10 (`needs-decision`), #11 | out of 1.1.0 until #10 is decided                       |

## Done in 1.0.0 and 1.0.1

v1.0.0 is apm-hub 3.3.0 (released there as `v3.2.1`) plus its unreleased `release/next` (apm-hub#881–#907): `deliver` for several issues or a milestone, `Invoke-DeliverLoop.ps1`, planning without Task issues, `planner refine` with a definition of ready, Biome for Markdown and YAML, `Format-Changed.ps1` detection without `-Language`. The layout is `skills/<group>/<name>/`, installed with `npx skills`. v1.0.1 fixes the group paths of the ported tests.

## 1.1.0 — learning path, trials and the end of the move

Milestone 1.1.0. `release/next` is cut from `v1.0.1`. Order: repository settings (#19, the ruleset is the gate of `deliver`), the test PBI #7, the trigger evals #20, the trials #4 and #5, the lessons PBIs #23–#28 of #3, the archive of apm-hub #21, the retro #6 if ten runs are reached, then the release #14.

| Order | Issue | Title                                                                              | Size | Depends on / decision                              |
| ----- | ----- | ---------------------------------------------------------------------------------- | ---- | -------------------------------------------------- |
| 1     | #19   | repository settings: ruleset on `release/next`, secrets, Pages, project, milestone | S    | owner                                              |
| 2     | #7    | pin the extension map of `Format-Changed.ps1` detection                            | S    | — (`needs-decision` removed: no open decision)     |
| 3     | #20   | port the skill trigger evals                                                       | M    | —                                                  |
| 4     | #4    | trial `deliver` in OpenCode                                                        | S    | `opencode` CLI and a provider login                |
| 4     | #5    | trial `deliver` in Copilot CLI                                                     | S    | —                                                  |
| 5     | #23   | lessons skill with contract and `Get-Lessons.ps1` loading                          | M    | —                                                  |
| 5     | #26   | `skills-install` names the `!.agents/lessons/` gitignore exception                 | S    | —                                                  |
| 5     | #24   | `Get-Lessons.ps1 -Check` validates lesson files                                    | S    | #23                                                |
| 5     | #25   | `implementation`, `code-review` and `planner` read lessons                         | M    | #23                                                |
| 5     | #27   | `retro` drafts lessons with status proposed                                        | M    | #24                                                |
| 5     | #28   | `retro` proposes retiring ineffective lessons                                      | S    | #27                                                |
| 6     | #21   | archive GravionLabs/apm-hub with a successor notice                                | S    | #19                                                |
| 7     | #6    | retro over ten `deliver` runs; decides on `workflow.js`                            | S    | #4, #5; moves to 1.2.0 if ten runs are not reached |
| 7     | #54   | link the repository skills as project skills for dogfooding                        | S    | retro #6                                           |
| 7     | #55   | `Remove-PbiWorktrees` deletes merged branches with `git branch -d` first           | S    | retro #6                                           |
| 7     | #56   | find the flaky tests of `pnpm run check`                                           | M    | retro #6                                           |
| 7     | #57   | remove the frozen `workflow.js`                                                    | S    | retro #6 decision                                  |
| 8     | #14   | release v1.1.0 with the learning path                                              | S    | #23–#28; owner approves the release PR             |

Retro #6 (2026-10-31, 14 `deliver` runs: 12 Claude Code, 1 OpenCode, 1 Copilot CLI): red CI at the end 0 %, fix rounds 0.21 per PBI, median time per PBI about 8 min, human wait ≈ 0 except the Copilot allowlist pause (fixed by #49); cost not measured (agentlens not installed). **Decision: `deliver/workflow.js` is deleted** (#57); plain subagents sufficed on all three harnesses. The Claude Code runs loaded an outdated global `deliver`, hence #54.

Feature #3 closes with its last PBI. Features #2 and #18 close when their PBIs are done; Epic #1 stays open for #15.

## Later

| Issue         | Title                                                     | Why later                                           |
| ------------- | --------------------------------------------------------- | --------------------------------------------------- |
| #16           | `deliver` reports step, issue and PR as herdr pane tokens | milestone 1.2.0 (Feature #15), refined              |
| #12, #13, #17 | herdr log pane, key toggle and plugin                     | milestone 1.2.0, refined; #13 ← #12, #17 ← #13, #16 |
| #10           | jvm package for Java and Kotlin                           | `needs-decision`: one `jvm` group or two            |
| #11           | swift package                                             | blocked by #10                                      |

## Risks

- `GitVersion.yml` still says `next-version: 1.0.0`. `github-release` `finish` adds `+semver: minor` (apm-hub#881), so the release PR should be tagged `v1.1.0`; check the computed version before merging.
- Without the ruleset of #19, `deliver` warns and a red PR can be merged.
- #4 needs an OpenCode installation and provider login; it was skipped in apm-hub for that reason.
