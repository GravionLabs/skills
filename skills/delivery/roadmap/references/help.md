# /roadmap

Plans the releases: assigns the open Features to `M<nnn>` milestones and keeps `ROADMAP.md`, which lists the Features per milestone. Nothing is set or written without your approval.

## Usage

```
/roadmap
/roadmap help
```

## Arguments and flags

- nothing: read the open work, propose the milestone table, ask the open decisions, set the milestones after approval, then show the `ROADMAP.md` diff and write it after approval.
- `help` (also `--help`, `-h`): print this text.

Proposal rules: the blocked-by order decides (a blocker lands in the same or an earlier milestone), release capacity is filled by size. PBIs and Bugs are never assigned (their milestone is set at merge): their size and blockers count towards their Feature, and one without a Feature is listed as `unplanned, ships at merge`. Existing open `M<nnn>` come first; a new one (`M004 (new)`) only when they are full. Open decisions go to `grill-me`.

Milestones are the releases (`M<nnn>`, `M<nnn> (x.y.z)` once released, legacy `x.y.z` stays valid). `roadmap` never renames or closes one; that is `github-milestone`. Generated parts of `ROADMAP.md` sit between `roadmap:begin` and `roadmap:end` markers; text outside is yours and never changed.

## Examples

```
/roadmap
/roadmap help
```

## Config

none

## See also

- `github-milestone`, which creates and closes the milestones
- `planner`, which creates the Features that are assigned
- `deliver`, which delivers a milestone
- `grill-me`, which asks the open decisions
