# ADR 0010: Milestones hold Features as a roadmap and record what a release shipped

- Status: Accepted
- Date: 2026-11-27
- Issues: #1067

## Context

A milestone does four jobs today (`github-issue` `references/milestones.md`): it is the planning unit of PBIs and Bugs (each always has one; a Feature only when all its PBIs are in it), the work unit of `deliver --milestone`, the scope of a release, and the anchor of `Requires: <repo>@<milestone>` between repositories.

Planning the work at PBI level in milestones costs more than it brings once Objectives sum up the requirements across repositories. The orchestrated run of GravionLabs/helix#1204 (2026-11-26/27) showed it:

- One owner decision (helix ADR 0013) needed four new milestones: helix M007.1 and M007.2, nixe M008.1, poimen M034.1.
- A milestone grew during the run because another session planned into it; the release gate had to re-read it.
- Open pull requests of another milestone into `release/next` blocked `github-release finish`.
- The rule "a PBI always has a milestone" is already broken where PBIs are planned ahead without a release in mind (helix#1243–#1260).

A rough plan of what comes next per repository is still useful to the owner. What ships in a release is already decided by what is merged into `release/next`, not by the milestone.

## Decision

A milestone is a **roadmap entry of Features** and the **record of what a release shipped**. The planning unit of work is the Objective and the Feature.

| Level     | Milestone                                                                                         |
| :-------- | :------------------------------------------------------------------------------------------------ |
| Objective | Never.                                                                                            |
| Epic      | Never.                                                                                            |
| Feature   | Planned: the release it is meant to ship in (rough roadmap). Moves when its last PBI ships later. |
| PBI, Bug  | Not planned. Set at merge into `release/next`: the open milestone that release branch is heading to. |

1. `planner` and `roadmap` assign Features to milestones, never PBIs or Bugs.
2. The merge into `release/next` sets the milestone of the merged PBI or Bug (the `release-branch.yml` workflow of GravionLabs/ci, which already closes the issue at merge). The milestone then lists exactly what shipped.
3. `github-release cut` creates the next milestone when it is missing, so a merge always has one to land in. A point release needs no planned milestone; it gets its record at merge.
4. A Feature whose PBIs ship across several releases moves to the milestone of the release that closes it.
5. `deliver --milestone M` works the open PBIs and Bugs below the Features of M; `deliver --feature <nr>` and `--objective` (#1041) work without a milestone.
6. `Requires: <repo>@<milestone>` stays and means: that milestone is closed after its tag. `Requires: <repo>#<feature>` is added and means: the Feature is closed and the release that shipped its last PBI is tagged.
7. The release test stays one per release (label `release-test`), created by `cut`.

Owner decisions (2026-11-27):

8. The `release-branch.yml` workflow of GravionLabs/ci sets the milestone at merge, not the loop, so merges by hand are recorded too.
9. A Bug without a parent Feature gets no planned milestone; urgency is a label, the milestone follows at merge.
10. `github-milestone current` no longer warns about a Feature whose PBIs sit in other milestones; it is the normal case.

## Consequences

- Planning a decision or a follow-up no longer needs a new milestone; mini milestones like M007.1 disappear.
- A milestone never grows by planning during a run; it grows only by merges, which is what it records.
- The milestone progress bar on GitHub no longer shows the open work of a release, only what shipped; the open work is shown by the Features of the milestone and by `github-milestone current`.
- `github-issue` `references/milestones.md`, `github-milestone` (assign and checks), `planner`, `roadmap`, `deliver`, `github-release` and the GravionLabs/ci `release-branch.yml` workflow change; #1041 decision 1 is restated in these terms.
- Existing open PBIs keep their milestone until a migration clears them; nothing breaks while both kinds exist.

## Alternatives

- **Keep the rule as it is.** Rejected: the run showed the overhead above, and the rule is already not kept.
- **Drop milestones; tags and changelogs only.** Rejected: loses the roadmap view the owner wants and the GitHub view of what shipped in a release.
- **Milestones only as a release record, no roadmap.** Rejected: nothing shows roughly what comes next per repository; Objectives span repositories and do not show a per-repository order.
