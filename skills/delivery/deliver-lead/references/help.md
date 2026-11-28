# /deliver-lead

Leads the delivery of one PBI or Bug on a worker host: an implementer worker, a reviewer worker, the gate scripts and the merge. The step script names each action; the lead executes it through the host adapter.

## Usage

```
/deliver-lead <issue> [--run <run>]
/deliver-lead help
```

## Arguments and flags

- `<issue>`: a PBI or Bug of the repository of this checkout. Features, Epics and milestones are not supported yet, Objectives are not covered.
- `--run <run>`: resume that run from its agent-events; without it a new run id is created and printed.
- `help` (also `--help`, `-h`): print this text.

Hosts: poimen, Orca, plain Claude Code. On other hosts use the loop of `deliver`.

## Examples

```
/deliver-lead 42
/deliver-lead 42 --run 019a8f2e-7c41-7d3a-9b10-4f6e2a1c8d55
/deliver-lead help
```

## Config

`.agents/config.json`: `deliver.base`, `deliver.tracker`, `deliver.harness`, `deliver.protectedPaths`, `deliver.mergeRisk`, and `models`. `AGENT_EVENTS_DIR` sets where the events of a run are written.

## See also

- `deliver`: one issue as one pull request, and the loop
- `host-poimen`, `host-orca`, `host-claude-code`: the host adapters
