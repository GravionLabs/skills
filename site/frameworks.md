# External skill and agent frameworks

What exists, what it ships, and whether it fits a lean solo setup that runs Claude Code, GitHub
Copilot and OpenCode from one source. Reviewed 2026-10-12, mattpocock/skills on 2026-11-23; star
counts and plugin numbers are approximate.

| Framework                                                                                                                                                                                | Ships                                                                                                                                                                                                                                                                | Clients                                                               | Fit                                                                                                                                                                                                                        | We use                                                                                                                                 |
| :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- |
| [angular/skills](https://github.com/angular/skills) (official)                                                                                                                           | `angular-developer`: one router SKILL.md plus ~30 references; `angular-new-app`                                                                                                                                                                                      | all skills clients                                                    | **Adopt.** Progressive disclosure done right; overlaps `ng-implementation`. Generic, no project conventions. APM path: `angular/skills/angular-developer#<sha>`.                                                           | planned (#94)                                                                                                                          |
| [dotnet/skills](https://github.com/dotnet/skills) (Microsoft)                                                                                                                            | 17 plugins under `plugins/`; `dotnet` = 4 skills + C# LSP, `dotnet-test` = 23 skills + 10 agents                                                                                                                                                                     | Copilot CLI, Claude Code, VS Code, Cursor, Codex                      | **Adopt `plugins/dotnet` only.** `dotnet-test` floods the skill list. Pin with `#<sha>`.                                                                                                                                   | decision open (#94)                                                                                                                    |
| [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official)                                                                                              | ~300 plugins: `commit-commands`, `pr-review-toolkit`, `code-review`, `feature-dev`, `skill-creator`, `security-guidance`, LSP plugins                                                                                                                                | Claude Code only                                                      | **Selective:** `skill-creator`, `pr-review-toolkit` (compare with `code-review` on one PR). `/plugin` shows the context cost of each. Nothing for Copilot or OpenCode.                                                     | user-local                                                                                                                             |
| [anthropics/skills](https://github.com/anthropics/skills)                                                                                                                                | docx/pdf/pptx/xlsx, frontend-design, mcp-builder, skill-creator; the spec                                                                                                                                                                                            | Claude Code, claude.ai, API                                           | Reference for skill authoring; no overlap with the workflow skills.                                                                                                                                                        | via `/plugin`                                                                                                                          |
| [obra/superpowers](https://github.com/obra/superpowers)                                                                                                                                  | 15 skills: TDD, brainstorming, writing-plans, subagent-driven-development, systematic-debugging; SessionStart bootstrap; v7.0.0 (2026-10-09)                                                                                                                         | Claude, Codex, Cursor, OpenCode, Copilot CLI, Gemini, …               | **Borrow, not adopt** (#96 closed without the A/B run, see [Evaluations](#evaluations)). Four mechanics copied into the agents (#113); no issue or release-branch model, no stack skills, mandatory bootstrap per session. | borrowed                                                                                                                               |
| [mattpocock/skills](https://github.com/mattpocock/skills)                                                                                                                                | 27 promoted skills (engineering, productivity), split into user-invoked and model-invoked: grilling, `to-spec`, `to-tickets`, `triage`, `wayfinder`, `tdd`, `diagnosing-bugs`, `code-review`, `domain-modeling`; tracker-neutral setup (GitHub, GitLab, local files) | Claude Code (plugin), Codex, Copilot, Gemini, any `npx skills` client | **Borrow, not adopt** (see [Evaluations](#evaluations)). Strong on alignment, design and domain language; no hierarchy, milestones, release branch or unattended loop, no stack skills, skill names collide with ours.     | borrowed (five adaptations), more planned (#945)                                                                                       |
| [github/awesome-copilot](https://github.com/github/awesome-copilot)                                                                                                                      | ~100 agents, skills, instructions, plugins (Gem Planner/Implementer/Reviewer, .NET agents)                                                                                                                                                                           | Copilot CLI/VS Code; installable with `npx skills`                    | Cherry-pick single agents by path if ever needed; agents are verbose.                                                                                                                                                      | no                                                                                                                                     |
| [wshobson/agents](https://github.com/wshobson/agents)                                                                                                                                    | 94 plugins, 202 agents, 184 skills; one Claude source + adapters for Codex/Cursor/OpenCode/Copilot                                                                                                                                                                   | Claude Code primary                                                   | Reference design for multi-client agent translation (the translation `apmw` does); far too large to adopt.                                                                                                                 | no                                                                                                                                     |
| [VoltAgent/awesome-claude-code-subagents](https://github.com/VoltAgent/awesome-claude-code-subagents), [davila7/claude-code-templates](https://github.com/davila7/claude-code-templates) | 100+ agents each                                                                                                                                                                                                                                                     | Claude Code                                                           | **No.** Every installed agent description sits in context each turn; generic prompts.                                                                                                                                      | no                                                                                                                                     |
| [BMAD-METHOD](https://github.com/bmad-code-org/BMAD-METHOD)                                                                                                                              | persona-based skills method (PM, architect, dev, test)                                                                                                                                                                                                               | Claude Code, Codex, any skills client                                 | **No.** Heavy ceremony, large context.                                                                                                                                                                                     | no                                                                                                                                     |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) (`npx skills add`)                                                                                                           | skills-only distributor, ~80 clients                                                                                                                                                                                                                                 | all                                                                   | Skills only, which is all this repository ships; lockfile (`skills-lock.json`), `check` and `update`.                                                                                                                      | Distribution of this repository: `npx skills add GravionLabs/skills`, wrapped by `/skills-manage` for groups and pinned external packs |
| [agentskills.io](https://agentskills.io/specification)                                                                                                                                   | the SKILL.md spec                                                                                                                                                                                                                                                    | all                                                                   | Followed; client keys (`context`, `disable-model-invocation`) are allowed extensions.                                                                                                                                      | yes                                                                                                                                    |
| [microsoft/apm](https://github.com/microsoft/apm)                                                                                                                                        | package manager: skills, agents, prompts, instructions, hooks, MCP; `apm.yml` dependencies with virtual paths and pins                                                                                                                                               | Copilot, Claude, OpenCode, Cursor, Codex, Kiro, …                     | Superset (agents, hooks, MCP, dependencies); the extra primitives are no longer used here.                                                                                                                                 | Distributed GravionLabs/apm-hub until its archive; replaced by `npx skills` since this repository ships skills only                    |

## Evaluations

### obra/superpowers v7.0.0 (desk analysis, 2026-10-12)

**Why not adopt.**

- No GitHub issue, sub-issue or release-branch model. Its unit of work is a spec file plus a plan
  file under `docs/superpowers/`; this hub's unit is the Epic → Feature → PBI issue and a PR
  per PBI into `release/next`. Adopting it would mean rebuilding `/deliver` on top of it.
- No stack skills. TDD is generic; `<lang>-implementation` and `<lang>-test` stay necessary.
- A SessionStart hook injects `using-superpowers` into every session and demands a skill check
  before any action, including clarifying questions. That collides with gated skills, and two mandatory process layers produce two review seats and two planning
  artifacts per change.
- Cost: its own strict-cost spec reports ~13 USD and ~150 controller turns per plan run on Opus and
  proposes a mid-tier orchestrator subagent as the remedy. [Work an issue by hand](guides/work-an-issue-by-hand.md) keeps one
  issue per session instead.
- A second distribution channel (a plugin per harness) next to `npx skills`.

**What we borrowed** (Feature #113, MIT licensed): the report-file status contract, the review package as a file and a per-issue record for resuming. They lived in agents of apm-hub until its 3.0.0; delivery is now the `deliver` skill ([delivery](delivery.md)).

`brainstorming` and `systematic-debugging` have no counterpart here. They could be imported as
standalone skills without the hook; that is an open owner decision, not yet an issue.

### mattpocock/skills (desk analysis, 2026-11-23)

Reviewed at commit `abeeaf9` (2026-11-19), MIT licensed. Since our first adaptations at `49dd158`
(2026-10-09) upstream changed 24 lines in the promoted skills.

**Why not adopt.**

- Flat issues with triage labels (`needs-triage`, `ready-for-agent`, …) instead of the Epic →
  Feature → PBI hierarchy with milestones and `release/next`. Mixing both models breaks the
  roadmap, the milestone checks and the project views.
- Every step is user-invoked (`/to-spec`, `/to-tickets`, `/implement`); there is no unattended
  loop with merge, required checks, app token and protected paths like `deliver`.
- The agent brief lives in an issue comment; `deliver` deliberately reads no comments, so the
  contract stays in the body.
- No stack skills and no deterministic gates; everything is prose.
- Installing it next to ours collides in the flat `npx skills` install (`code-review`,
  `grill-me`, `retro`) and loads a second set of descriptions.
- It accepts no new skills and stays harness-neutral on purpose (it rejects `AskUserQuestion`);
  changes for our model have no path upstream.

**What we borrowed** (at `49dd158`, each file names its source):

| From              | Into                                              |
| :---------------- | :------------------------------------------------ |
| `grilling`        | `grill-me`                                        |
| `diagnosing-bugs` | `diagnose` and `diagnose/references/loops.md`     |
| `tdd`             | `implementation/references/test-quality.md`       |
| `to-tickets`      | `planner/references/slicing.md`                   |
| `retro`           | `retro/references/categories.md` (categories 1–6) |

**Planned** (Epic #945):

- Existing skills (#946): a spec section in `code-review` that also reports unrequested behavior,
  a Fowler smell baseline as notes, the PR summary as the smallest visual, the `gh` 2.94
  shortcuts, current and desired behavior plus out of scope in the PBI and Bug contract, test seams
  as a planning decision.
- New skills (#947): `github-triage` for issues filed by others, `glossary` with
  `grill-me --docs`, `handoff`, `prototype`, `wizard`, `architecture-survey`.
- A parallel ready frontier in `deliver-loop` (#948, from `implement-spec` and the claim by
  assignee of `wayfinder`) and `planner chart`, a decision map for foggy Objectives and Epics
  (#949, from `wayfinder`).

Not taken: `ask-matt` (router), `to-questionnaire`, `wait-what`, `teach`, the `writing-*` skills,
the three-way split `grilling` / `grill-me` / `grill-with-docs`.

## How to add an external pack

1. Find the smallest installable unit: a SKILL.md directory or a plugin directory, not a repo root
   (`angular/skills` root is not a package; `dotnet/skills` root installs everything).
2. Probe in a scratch directory: `npx skills add <owner/repo> --list` and count the `SKILL.md`
   files. More than ~5 descriptions per pack needs a reason.
3. Pin the ref (`<owner/repo>#<sha>`) and add the source with its skill names to the `external` map of
   `skills/delivery/skills-manage/scripts/Install-Skills.ps1`, next to the group it belongs to.
4. Remove what the pack now covers from the own skill; keep project conventions and `## Review rules`.
