# Plan the roadmap

`roadmap` decides which release each open Epic, Feature, PBI and Bug belongs to. It proposes `M<nnn>` milestones, asks the open decisions, sets the milestones after approval and keeps `ROADMAP.md`. It is user-invoked; `/roadmap help` prints its usage. `planner` creates the issues and stays free of milestones.

## The path

```text
/roadmap
```

1. **Read.** The open issues with size, parent, blockers and milestone come from GitHub; nothing is stored.
2. **Propose.** A table ordered by the blocked-by graph: a blocker lands in the same or an earlier milestone than the issues it blocks, children follow their parent, size fills a release. Existing open `M<nnn>` come first; a new one is marked `(new)`.
3. **Decide.** Open points (scope per release, missing size, `needs-decision`, cycles) go to `grill-me`. Unresolved issues stay out.
4. **Set.** After you approve the table, the milestones are set and a missing `M<nnn>` is created.
5. **Write.** `ROADMAP.md` is shown as a diff first and written only after your approval. Generated parts sit between `roadmap:begin` and `roadmap:end` markers; your own text outside them is never changed.

Nothing is changed before you approve a proposal. `roadmap` never renames or closes a milestone; that is `github-milestone` at release time.

## Next

Deliver a milestone as described in [Release a milestone](release.md).
