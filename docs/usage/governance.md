# ADRs and specs

An architecture decision record (ADR) records one decision; a spec describes what a service shows to others (API, configuration, visible behavior). With the `governance` key in `.agents/config.json`, the skills and the CI checks of GravionLabs/ci hold changes to the same ADR and spec rules. The key and its fields are described in [project config](project-config.md#governance); this page shows who reads it and when.

Without the key nothing changes: `adr` still writes an ADR on request (in `docs/adr`), but no skill and no CI check demands an ADR or a spec update.

## Who does what

| Step      | Skill or check               | With `governance`                                                                                                                                                                                                                                                                                                                                                                          |
| :-------- | :--------------------------- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Detect    | `detect-techstack`           | reports `governance`: `configured`, the ADR and spec counts of `adrDir` and `specDir`, and a hint when `docs/adr` or `docs/specs` exist without the key                                                                                                                                                                                                                                    |
| Plan      | `planner`, `github-issue`    | an item that touches `adrPaths`, adds a service or an external dependency, or reverses an accepted ADR gets a decision PBI (`docs: ADR <topic>`, label `needs-decision`, criterion `ADR (the next free ADR number) with Status: Proposed`) that blocks it; an item under a `specMap` glob gets the spec criterion                                                                          |
| Decide    | `adr`                        | `New-Adr.ps1` writes `<adrDir>/NNNN-<slug>.md` with the next free number and `Status: Proposed`; only the owner accepts                                                                                                                                                                                                                                                                    |
| Implement | `implementation`             | a spec change (public API, configuration, visible behavior) updates the spec in the same commit; no change needed: the note `no spec change needed: <spec> — <reason>`; a new service gets a spec from `templates/spec.md` and a `specMap` entry                                                                                                                                           |
| Review    | `code-review`                | `Get-GovernanceMatches.ps1` lists the changed files of the diff under `adrPaths` and per `specMap` glob; `adr-missing` is blocking unless the same diff adds or changes a file in `adrDir` or the issue carries a label of `skipLabels` (default `skip-adr`); `spec-drift` (blocking with `specMode: require`, else a note; a matching `no spec change needed:` note turns it into a note) |
| Deliver   | `deliver`                    | skips a decision PBI (`select: decision, write the ADR with adr`), PBIs it blocks wait; passes the issue labels and implementer notes to the review and the `no spec change needed:` lines to the PR body (`## Spec`)                                                                                                                                                                      |
| CI        | GravionLabs/ci `adr`, `spec` | the same rules on the pull request: an `adrPaths` change fails unless the same PR adds or changes a file in `adrDir` or the PR carries a label of `skipLabels`; a `specMap` change without its spec warns or fails per `specMode`, unless the PR body names the spec in a `no spec change needed:` line (the `spec` job is GravionLabs/ci#95)                                              |

The spec criterion of `planner` has an exact wording, because `code-review` and CI look for it:

```markdown
- [ ] spec updated or `no spec change needed: <spec>` noted
```

## Example flow

A project has `"adrPaths": ["infra/**"]` and `"specMap": { "apps/gateway/**": "docs/specs/gateway.md" }`.

1. `planner` plans Feature #40, which moves the gateway to a new message broker. The broker is a new external dependency under `infra/`, so the plan holds a decision PBI `docs: ADR message broker` (`needs-decision`) and the implementing PBI, blocked by it, with `Spec: docs/specs/gateway.md` and the spec criterion.
2. `/deliver --milestone 1.4.0` skips the decision PBI and reports `#41 select: decision, write the ADR with adr`; the implementing PBI waits.
3. You write the ADR with `adr` (`New-Adr.ps1 -Title "Message broker" -Issue 41`) and accept it. Remove `needs-decision` from #41 first, then merge the ADR in its own PR with `Closes #41`: the `readiness` check needs that closing reference and fails a PR whose closed issue still carries `needs-decision`. The PR targets `release/next`, where `Closes` does not fire, so close #41 by hand after the merge, as `deliver` does: `gh issue close 41 --comment "Decided in #<pr>"`; an open #41 would later be selected by `deliver` as a normal PBI and keep blocking the implementing PBI. The PR touches only `adrDir`, so the `adr` check validates its number and `Status:` line and passes.
4. Both ADR checks look only at their own diff: `code-review` at the PBI diff, the CI `adr` check at the files of the PR. An ADR merged earlier does not count, so the implementing PR, which changes `infra/` without a file in `adrDir`, would get `adr-missing` and a failing `adr` check. Because the decision is already recorded, waive the rule with the label `skip-adr` (`skipLabels`) on the implementing PBI, which `deliver` passes to `code-review`. The CI check reads only the labels of the PR, and that PR does not exist yet.
5. `/deliver` resumes: `implementation` changes `infra/` and `apps/gateway/` and updates `docs/specs/gateway.md` in the same commit; `code-review` skips `adr-missing` because of the label and finds the spec change, so `spec-drift` does not fire. `deliver` opens the PR through `github-pull-request`, which reads the issue labels but puts none on the PR, so the PR has no `skip-adr`, the CI `adr` check fails and `gh pr checks --watch` blocks the PR. Add `skip-adr` to the PR and re-run the check: the workflow runs on `opened`, `edited`, `synchronize` and `reopened`, not on `labeled`, so edit the PR or run `gh run rerun <run-id>`. With `adr` and `spec` green, `/deliver <nr>` again continues with the open PR and merges it.

Without the label, the ADR has to be part of the implementing PR itself: a new ADR, or a change to the merged one in the same diff, satisfies both `code-review` and the `adr` check.

Had the gateway change touched only internals, the implementer would note `no spec change needed: docs/specs/gateway.md — internal refactoring`; `deliver` puts that line under `## Spec` in the PR body, where `code-review` and the `spec` check accept it.

## Details

- [Project config](project-config.md#governance): the `governance` fields and an example
- [Delivery](../delivery.md#decision-pbis-and-spec-notes): decision PBIs and spec notes in `deliver`
- Skill references: `adr` `references/when.md`, `planner` `references/governance.md`, `implementation` `references/specs.md`, `code-review` `references/governance.md`, `deliver` `references/governance.md`
