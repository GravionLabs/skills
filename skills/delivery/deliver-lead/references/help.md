# /deliver-lead

Leads delivery on a worker host. A PBI or Bug: an implementer worker, a reviewer worker, the gate scripts and the merge. A Feature, Epic or milestone: one leaf lead per open PBI and Bug of its tree, in `blocked-by` order, and for a milestone the release gate at the end. The step script names each action; the lead executes it through the host adapter.

## Usage

```
/deliver-lead <issue|M<nnn>> [--run <run>]
/deliver-lead help
```

## Arguments and flags

- `<issue|M<nnn>>`: a PBI, Bug, Feature or Epic, or a milestone, of the repository of this checkout. Objectives are not covered.
- `--run <run>`: resume that run from its agent-events; without it a new run id is created and printed. An issue another run or the loop left in an `agent:*` stage resumes from that stage, without repeating a merge; a resumed tree goes on with the open leaves.
- `help` (also `--help`, `-h`): print this text.

Hosts: poimen, Orca, plain Claude Code. On other hosts use the loop of `deliver`.

## Examples

```
/deliver-lead 42
/deliver-lead 42 --run 019a8f2e-7c41-7d3a-9b10-4f6e2a1c8d55
/deliver-lead M001
/deliver-lead help
```

## Config

`.agents/config.json`: `deliver.base`, `deliver.tracker`, `deliver.harness`, `deliver.parallel` (leaf leads at once, default 1), `deliver.protectedPaths`, `deliver.mergeRisk`, and `models`. `AGENT_EVENTS_DIR` sets where the events of a run are written.

## See also

- `deliver`: one issue as one pull request, and the loop
- `host-poimen`, `host-orca`, `host-claude-code`: the host adapters
