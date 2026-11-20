# Spike: a Claude Code mod for the subagent row (#746)

Status: finished 2026-11-20 on Claude Code 2.1.329. Related: #745.

## Question

Can a mod bring back the subagent line of `context-statusline` (`<agentType> <model> ctx:<pct>% (<k>k/<size>k) · <label>`) after Claude Code 2.1.323 removed `subagentStatusLine`, and where would such mods live?

## Result

A local mod (about 40 lines, `hooks/register.tsx`) hooks `ui.render` on `{ component: 'AgentRow' }` and sets `props.body`. It lives outside this repository (`~/.claude/dev-mods/<session>/subagent-row/`); the spike merges no mod.

```ts
on('ui.render', { component: 'AgentRow' }, ($, e, next) =>
  next({ ...e, props: { ...e.props, body: rowBody(e.props) } }),
);
```

### Fields of the old line

| Field            | Available | Source                                                                               |
| :--------------- | :-------- | :----------------------------------------------------------------------------------- |
| agent type       | yes       | `type`                                                                               |
| model            | yes       | `model` (id, moves with a fallback; absent for a pane teammate)                      |
| context size     | yes       | `contextWindowSize` (absent when `model` is)                                         |
| used tokens      | yes       | `tokenCount` (latest input + all output, an estimate of context use)                 |
| percent          | yes       | computed: `tokenCount / contextWindowSize`                                           |
| label            | yes       | `label` (latest progress summary, model text, may hold line breaks)                  |
| old `ctx` number | approx.   | the old line used the transcript's usage; `tokenCount` is the closest measured value |

Without `contextWindowSize` the mod drops the `ctx` part. Line breaks in `label` are collapsed (a break would make the row taller).

### Colours

`body` accepts SGR sequences. Yellow from `min(50 % of size, 250k)`, red from `min(80 % of size, 500k)` work as in the old line (checked in `tests/row.test.tsx`: yellow at 250k of 1M, red at 500k of 1M and at 160k of 200k). Not checked in a live subagent row: the session of this spike draws no terminal, so the rendering itself is untested.

### Checks

- `claude plugin test`: 3 of 3 pass (`rowBody` thresholds; the hook is not mounted, since `$.ui.mount` of `AgentRow` was not tried).
- `claude plugin validate --strict`: the mod itself is clean (hooks `ui.render{component=AgentRow}`, calls nothing on `$`). `--strict` still fails on the plugin directory checks: README missing, LICENSE missing (or `license` in `plugin.json`), icon missing (warning).

CI for mods would need: `claude plugin validate --strict` and `claude plugin test` per mod folder (Claude Code installed in CI, a pinned version because the API changes without notice), `tsc -p` against the types the engine writes on first load (no committed copy exists), and per mod a README, a licence and an icon if the directory is the goal. Function hooks must be enabled where the mod loads.

## Recommendation

**Not now.**

- Mods are early access; the hook API can change between releases without notice, and CI would need a pinned Claude Code to stay green.
- This repository is harness-neutral (Claude Code, OpenCode, Copilot); a mod is Claude Code only and has its own install path (`/plugin install`), not `npx skills`.
- The subagent row is cosmetic; the main `statusLine` (still supported) keeps the context warning.
- `anthropics/claude-code/mods` is "All rights reserved": reference for the layout only.

If the demand shows up: put mods in an own repository (such as `claude-mods`) with its own `.claude-plugin/marketplace.json`, one folder per mod, `tests/`, a shared `tsconfig.json`, and the CI above. Not in this repository's marketplace, whose plugins are skill groups. The spike's `register.tsx` can be the first mod of that repository.

No follow-up issues: the spike closes with "not now".
