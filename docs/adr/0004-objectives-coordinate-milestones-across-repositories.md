# ADR 0004: Objectives coordinate milestones across repositories

- Status: Proposed
- Date: 2026-11-11
- Issues: #533, #531

## Context

A release of one repository often depends on a release of another: a skill change needs a new version of a CI workflow, a panel needs a new event format. Milestones (`M<nnn>`) are the releases of one repository and know nothing about each other. The Epic, Feature, PBI hierarchy stops at the repository border as well. Nobody sees, in one place, which outcome spans which repositories, in which order the releases must happen, and what is still open.

Some of the repositories are internal. Whatever coordinates them must not be public, and it must not need a repository of its own to be a member of.

GitHub offers no object above repositories. GravionLabs is a user account, so Issue Types, which exist only for organizations, are not available.

## Decision

A new level, the Objective, is an issue titled `[Objective] <summary>` in the private repository `telos`. It stands above the repositories (Option A).

- An Objective holds only the outcome, the affected repositories, the dependencies, the status, the acceptance criteria and its children (the Epics, Features and PBIs of the member repositories as sub-issues or links). It holds no implementation details and no `release/next`.
- `telos` is private because internal repositories are coordinated too.
- A release edge is a line `Requires: <owner>/<repo>#<n>` or `Requires: <owner>/<repo> <milestone>` in the issue that needs another release. The Objective names milestones only through such lines.
- The milestone rule does not change: a milestone is a release of one repository. An Objective lies in no milestone.
- An orchestrator is the scheduler. It reads the Objectives and the `Requires:` lines, orders the work across repositories and starts `deliver-loop` per repository and milestone. It delivers nothing itself.
- The levels stay labels: Objective, Epic, Feature, PBI, Bug. The mapping to Issue Types is 1:1, so a later switch (an organization) renames nothing but the mechanism.
- Status is computed from GitHub on each read. Nothing is maintained in `telos` except the runner marker of the orchestrator.

The conventions themselves (title, template, label, the exact `Requires:` grammar) and the scripts are the work of later PBIs and are not decided here.

## Consequences

- Easier:
  - One place shows the outcome, the repositories involved and the order of their releases.
  - Internal repositories are coordinated without being published.
  - Existing milestones, `deliver` and `deliver-loop` work unchanged; the edge is one parseable line.
  - A later move to Issue Types is a mapping, not a redesign.
- Harder: a new repository and a new issue level to know and to keep out of the implementation detail.
- Harder: `Requires:` lines are text. A typo breaks an edge, so the orchestrator must report lines it cannot resolve.
- Harder: computing the status from GitHub costs API calls on each read. There is no cache to go stale, and no second copy to repair.
- Cross-repository sub-issue links depend on the access of the token to the member repositories.

## Alternatives

- **A: Objective in `telos` (chosen).** An issue is the object every skill already handles, its body and comments are readable by `gh`, and a private repository fits internal members. Ordering is expressed in text and resolved by the orchestrator.
- **B: a field `Plan` in Project #17.** A Project field groups issues of several repositories without a new repository. It is rejected because the field is reachable by GraphQL only (no plain `gh issue` read), and it carries no ordering: a field says that issues belong together, not which release comes first.
- **C: same-named milestones and a manifest.** Equal milestone names in all repositories, plus a manifest file listing them. It is rejected because it creates a second source of truth next to the milestones themselves. The names and the manifest drift apart, and the milestone rule (a release of one repository) is bent to carry a cross-repository meaning.
