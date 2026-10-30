export const meta = {
  name: 'deliver',
  description: 'Deliver a PBI, Feature or Epic: plan, implement, gate, review, PR, CI, merge, close',
  phases: [
    { title: 'Select', detail: 'resolve the issue to approved, unblocked PBIs in dependency order' },
    { title: 'Plan', detail: 'missing breakdowns; open questions stop the run' },
    { title: 'Deliver', detail: 'one PBI at a time: implement, gate, review, PR, CI, merge' },
  ],
}

// Frozen (#861): SKILL.md no longer starts this workflow; it stays until the retro (#865) decides about it.
// args: { issue: <nr>, base?: 'release/next', maxFixRounds?: 2, roles?: <deliver.roles>, answers?: { '<nr>': [{ question, answer }] } }
// Result: { status: 'questions', questions } | { status: 'done', delivered, blocked, skipped }

const input = args ?? {}
if (!Number.isInteger(input.issue)) throw new Error('deliver: args.issue must be an issue number')

const ISSUE = input.issue
const BASE = input.base ?? 'release/next'
const MAX_FIX = input.maxFixRounds ?? 2
const ANSWERS = input.answers ?? {}

const TIERS = {
  fast: { model: 'haiku', effort: 'low' },
  standard: { model: 'sonnet', effort: 'medium' },
  strong: { model: 'opus', effort: 'high' },
}
const DEFAULT_ROLES = {
  select: { model: 'haiku', effort: 'low' },
  plan: {},
  create: { model: 'haiku', effort: 'low' },
  implement: { tiers: TIERS },
  fix: { tiers: TIERS },
  gate: { model: 'haiku', effort: 'low' },
  review: { model: 'sonnet', effort: 'medium' },
  pr: { model: 'haiku', effort: 'low' },
  ci: { model: 'haiku', effort: 'low' },
}

// Model and effort of a role; a role with `tiers` takes the entry of the PBI's tier on top. Unset keys are omitted so the agent inherits the session value.
function roleOpts(role, tier) {
  const base = DEFAULT_ROLES[role] ?? {}
  const own = (input.roles ?? {})[role] ?? {}
  const tiers = { ...(base.tiers ?? {}), ...(own.tiers ?? {}) }
  for (const t of Object.keys(tiers)) tiers[t] = { ...(base.tiers ?? {})[t], ...(own.tiers ?? {})[t] }
  const merged = { ...base, ...own }
  const picked = tier ? tiers[tier] ?? {} : {}
  const out = {}
  const model = picked.model ?? merged.model
  const effort = picked.effort ?? merged.effort
  if (model) out.model = model
  if (effort) out.effort = effort
  return out
}

const TIER_ENUM = ['fast', 'standard', 'strong']
const STR = { type: 'string' }
const INT = { type: 'integer' }
const INTS = { type: 'array', items: INT }

const SELECT = {
  type: 'object',
  properties: {
    level: { enum: ['Epic', 'Feature', 'PBI'] },
    pbis: {
      type: 'array',
      items: {
        type: 'object',
        properties: { nr: INT, title: STR, tier: { enum: TIER_ENUM }, branch: STR, blocked_by: INTS },
        required: ['nr', 'title', 'tier', 'branch', 'blocked_by'],
      },
    },
    missing: {
      type: 'array',
      items: { type: 'object', properties: { nr: INT, level: { enum: ['Epic', 'Feature'] } }, required: ['nr', 'level'] },
    },
    skipped: {
      type: 'array',
      items: { type: 'object', properties: { nr: INT, reason: STR }, required: ['nr', 'reason'] },
    },
  },
  required: ['level', 'pbis', 'missing', 'skipped'],
}
const PLAN = {
  type: 'object',
  properties: {
    plan: { type: 'string', description: 'the plan as JSON text (references/plan-schema.md of planner)' },
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: { id: STR, question: STR, options: { type: 'array', items: STR }, recommended: STR, why: STR, blocks: { type: 'array', items: STR } },
        required: ['id', 'question', 'options', 'recommended', 'why'],
      },
    },
  },
  required: ['plan', 'questions'],
}
const CREATED = { type: 'object', properties: { created: INTS }, required: ['created'] }
const IMPL = {
  type: 'object',
  properties: { status: { enum: ['ok', 'blocked'] }, reason: STR, summary: STR },
  required: ['status'],
}
const GATE = {
  type: 'object',
  properties: { green: { type: 'boolean' }, commands: { type: 'array', items: STR }, failure_tail: STR },
  required: ['green', 'commands'],
}
const REVIEW = {
  type: 'object',
  properties: { blocking: { type: 'array', items: STR }, unmet: { type: 'array', items: STR }, notes: { type: 'array', items: STR } },
  required: ['blocking', 'unmet', 'notes'],
}
const PR = { type: 'object', properties: { pr: INT, url: STR }, required: ['pr', 'url'] }
const CI = {
  type: 'object',
  properties: {
    state: { enum: ['merged', 'red', 'none', 'denied'] },
    caused_by_change: { type: 'boolean' },
    failure_tail: STR,
    reason: STR,
  },
  required: ['state'],
}

const SKILL = (name) => `Use the Skill tool to load the skill \`${name}\`.`
const CHECKOUT = (p) =>
  `Work in your worktree. Run \`git fetch origin ${p.branch}\`, then \`git switch -C ${p.branch} origin/${p.branch}\`.`
const SIMPLE = 'Use simple shell commands: no quoted substitutions and no command chaining with $(...).'

function selectPrompt() {
  return `Resolve GitHub issue #${ISSUE} for delivery. ${SKILL('github-issue')}
Read it with \`gh issue view ${ISSUE} --json title,body,labels\`; the level is the title prefix ([Epic], [Feature], [PBI]).
- PBI: it is the only candidate. Feature: its open PBI sub-issues. Epic: the open PBI sub-issues of its Features. Use the native sub-issue links (references/sub-issues.md).
- A Feature (or Epic child Feature) without any PBI sub-issue goes to \`missing\` with its level.
- A candidate with the label \`needs-decision\`, or that is not open, goes to \`skipped\` with the reason. Every other open PBI goes to \`pbis\`.
- \`blocked_by\`: the numbers of the open blockers of the PBI (native dependency API, references/sub-issues.md, "Blocked-by links").
- Order \`pbis\` so a blocker that is part of the list comes before its dependents; otherwise by issue number.
- \`tier\`: the \`Tier:\` line of the body (fast, standard, strong); without it from the size (S fast, M standard, L strong); otherwise standard.
- \`branch\`: <type>/<nr>-<slug>; type from the conventional prefix of the title (chore, feat, docs, ci, fix; otherwise feat), slug at most 40 characters from the summary, lowercase, hyphens.
Read only; change nothing. ${SIMPLE}`
}

function planPrompt(m) {
  const given = ANSWERS[m.nr] ?? []
  const answers = given.length
    ? `Answers already given are final; do not ask them again:\n${given.map((a) => `- ${a.question} — ${a.answer}`).join('\n')}\n`
    : ''
  return `Plan the breakdown of ${m.level} #${m.nr}. ${SKILL('planner')} Use the non-interactive mode: ask nothing, create no issues; return the plan and the open questions as data.
${answers}Return \`plan\` (the plan JSON as text) and \`questions\` (empty when nothing is open).`
}

function createPrompt(m, plan) {
  return `Create the issues of this approved plan under ${m.level} #${m.nr}. ${SKILL('github-issue')} Follow references/create-from-plan.md; skip its approval step, the plan was approved by starting the delivery. Report the created issue numbers.
Plan:
${plan}
${SIMPLE}`
}

function implementPrompt(p) {
  return `Implement PBI #${p.nr} (${p.title}). Work in your worktree.
1. \`git fetch origin ${BASE}\`. When \`git ls-remote --heads origin ${p.branch}\` lists the branch (earlier run), \`git fetch origin ${p.branch}\`, \`git switch -C ${p.branch} origin/${p.branch}\`, \`git rebase origin/${BASE}\` and continue from its commits; on a rebase conflict return status blocked. Otherwise \`git switch -c ${p.branch} origin/${BASE}\`.
2. Read the issue (\`gh issue view ${p.nr} --json title,body\`). The acceptance criteria are the scope, the technical notes say how. Read every file it names.
3. ${SKILL('implementation')} Tests change together with the code. Commits: \`<type>: <description> (#${p.nr})\`, files added by name.
4. \`git push -u origin ${p.branch}\` (\`--force-with-lease\` after a rebase).
If a criterion cannot be met as written, change nothing further and return status blocked with the reason.
${SIMPLE}`
}

function gatePrompt(p) {
  return `Run the gate for PBI #${p.nr}. ${CHECKOUT(p)}
Run the verify commands of the repository's AGENTS.md (section Commands: build, tests, format check, lint) and those named in the technical notes of issue #${p.nr}. Report every command you ran and whether all passed; on a failure the last 40 lines of its output as failure_tail. Fix nothing.
${SIMPLE}`
}

function reviewPrompt(p) {
  return `Review PBI #${p.nr}. ${CHECKOUT(p)} ${SKILL('code-review')}
Review \`git diff origin/${BASE}...HEAD\` against the acceptance criteria of issue #${p.nr} (\`gh issue view ${p.nr} --json body\`). blocking: 🔴 findings; unmet: acceptance criteria the diff does not meet; notes: 🟡 and 🟢 findings, one line each. Change nothing.
${SIMPLE}`
}

function fixPrompt(p, problem) {
  return `Fix PBI #${p.nr}. ${CHECKOUT(p)} ${SKILL('implementation')}
Problem (${problem.kind}):
${problem.text}
Fix exactly this, rerun the verify commands of the repository's AGENTS.md, commit (\`fix: <description> (#${p.nr})\`, files added by name) and \`git push origin ${p.branch}\`. If it cannot be fixed, change nothing and return status blocked with the reason.
${SIMPLE}`
}

function prPrompt(p, notes, commands) {
  return `Open the pull request for PBI #${p.nr}. ${SKILL('github-pull-request')}
Head ${p.branch}, base ${BASE}. When \`gh pr list --head ${p.branch} --state open\` already shows a PR, reuse it and update its body instead of opening another. Body: \`Closes #${p.nr}\`, a short summary, \`## Review notes\` with the notes below (or "none"), \`## Test result\` with the commands below.
Notes:
${notes.map((n) => `- ${n}`).join('\n') || '- none'}
Commands:
${commands.map((c) => `- ${c}`).join('\n')}
${SIMPLE}`
}

function ciPrompt(p, pr) {
  return `Finish PR #${pr} of PBI #${p.nr}.
1. \`gh pr checks ${pr} --watch --interval 20\` (Bash timeout 600000 ms; run it once more if it times out). No checks reported after 2 minutes: state none.
2. All green: \`gh pr merge ${pr} --squash --delete-branch\`, then close issue #${p.nr} (\`gh issue close ${p.nr} --comment "Delivered in #${pr}"\`; Closes does not fire on ${BASE}). Merge denied by permission: state denied with the reason.
3. A check failed: read the log (\`gh run view <run-id> --log-failed\`, last 80 lines) and compare with \`gh run list --branch ${BASE} --limit 3\`. state red, failure_tail the log tail, caused_by_change true only for a test, lint or build error in files of this PR's diff; a flake or a failure that is red on ${BASE} too is false, then comment on the PR.
Never merge on a red or pending check.
${SIMPLE}`
}

async function selectIssues() {
  return agent(selectPrompt(), { label: `select #${ISSUE}`, phase: 'Select', schema: SELECT, ...roleOpts('select') })
}

phase('Select')
let sel = await selectIssues()
if (!sel) throw new Error(`deliver: could not resolve #${ISSUE}`)

phase('Plan')
if (sel.missing.length) {
  const plans = await pipeline(sel.missing, (m) =>
    agent(planPrompt(m), { label: `plan #${m.nr}`, phase: 'Plan', schema: PLAN, ...roleOpts('plan') }),
  )
  const open = []
  sel.missing.forEach((m, i) => {
    const r = plans[i]
    if (!r) open.push({ target: m.nr, id: 'plan', question: `The plan of #${m.nr} failed`, options: ['retry'], recommended: 'retry', why: 'The planner returned nothing.' })
    else for (const q of r.questions) open.push({ target: m.nr, ...q })
  })
  if (open.length) {
    log(`${open.length} open question(s); asking in the main session`)
    return { status: 'questions', questions: open }
  }
  await pipeline(sel.missing, (m, _i, idx) =>
    agent(createPrompt(m, plans[idx].plan), { label: `create #${m.nr}`, phase: 'Plan', schema: CREATED, ...roleOpts('create') }),
  )
  sel = await selectIssues()
  if (!sel) throw new Error(`deliver: could not resolve #${ISSUE} after planning`)
  for (const m of sel.missing) sel.skipped.push({ nr: m.nr, reason: 'no breakdown after planning' })
}

phase('Deliver')
const delivered = []
const blocked = []
const done = new Set()

function fail(p, reason, pr) {
  return { ok: false, reason, ...(pr ? { pr } : {}) }
}

async function deliverOne(p) {
  const at = (role) => ({ phase: 'Deliver', isolation: 'worktree', ...roleOpts(role, p.tier) })
  const impl = await agent(implementPrompt(p), { label: `implement #${p.nr}`, schema: IMPL, ...at('implement') })
  if (!impl) return fail(p, 'implement agent returned nothing')
  if (impl.status !== 'ok') return fail(p, impl.reason ?? 'implementation blocked')
  log(`#${p.nr} implement ok`)

  // Gate, review and CI share the fix rounds; a CI fix goes through gate and review again before the next CI run.
  let rounds = 0
  let url = null
  for (;;) {
    let notes = []
    let commands = []
    for (;;) {
      let problem = null
      const gate = await agent(gatePrompt(p), { label: `gate #${p.nr}`, schema: GATE, ...at('gate') })
      if (!gate) return fail(p, 'gate agent returned nothing', url)
      commands = gate.commands
      if (!gate.green) {
        problem = { kind: 'gate', summary: 'gate red', text: gate.failure_tail ?? 'verify commands failed' }
      } else {
        log(`#${p.nr} gate green`)
        const rev = await agent(reviewPrompt(p), { label: `review #${p.nr}`, schema: REVIEW, ...at('review') })
        if (!rev) return fail(p, 'review agent returned nothing', url)
        notes = rev.notes
        const items = [...rev.blocking, ...rev.unmet.map((u) => `unmet criterion: ${u}`)]
        if (items.length) {
          const summary = `review: ${rev.blocking.length} blocking, ${rev.unmet.length} unmet`
          problem = { kind: 'review', summary, text: items.map((i) => `- ${i}`).join('\n') }
        } else log(`#${p.nr} review clean`)
      }
      if (!problem) break
      if (rounds >= MAX_FIX) return fail(p, `${problem.kind} not clean after ${MAX_FIX} fix rounds: ${problem.text}`, url)
      rounds++
      log(`#${p.nr} ${problem.summary} → fix ${rounds}/${MAX_FIX}`)
      const fx = await agent(fixPrompt(p, problem), { label: `fix #${p.nr}`, schema: IMPL, ...at('fix') })
      if (!fx || fx.status !== 'ok') return fail(p, fx?.reason ?? 'fix agent returned nothing', url)
    }

    const pr = await agent(prPrompt(p, notes, commands), { label: `pr #${p.nr}`, phase: 'Deliver', schema: PR, ...roleOpts('pr', p.tier) })
    if (!pr) return fail(p, 'pr agent returned nothing', url)
    url = pr.url
    log(`#${p.nr} PR ${url}, waiting for CI`)
    const ci = await agent(ciPrompt(p, pr.pr), { label: `ci #${p.nr}`, phase: 'Deliver', schema: CI, ...roleOpts('ci', p.tier) })
    if (!ci) return fail(p, 'ci agent returned nothing', url)
    if (ci.state === 'merged') return { ok: true, pr: url }
    if (ci.state === 'red' && ci.caused_by_change && rounds < MAX_FIX) {
      rounds++
      log(`#${p.nr} CI red, caused by the change → fix ${rounds}/${MAX_FIX}`)
      const fx = await agent(fixPrompt(p, { kind: 'ci', text: ci.failure_tail ?? 'a check failed' }), { label: `fix #${p.nr}`, schema: IMPL, ...at('fix') })
      if (!fx || fx.status !== 'ok') return fail(p, fx?.reason ?? 'fix agent returned nothing', url)
      continue
    }
    return fail(p, ci.reason ?? `CI ${ci.state}: ${ci.failure_tail ?? ''}`.trim(), url)
  }
}

for (const p of sel.pbis) {
  const waiting = p.blocked_by.filter((b) => !done.has(b))
  if (waiting.length) {
    const why = waiting.map((b) => (sel.pbis.some((x) => x.nr === b) ? `#${b} not delivered` : `#${b} is open`)).join(', ')
    blocked.push({ nr: p.nr, reason: `blocked by ${why}` })
    log(`#${p.nr} blocked: ${why}`)
    continue
  }
  let r
  try {
    r = await deliverOne(p)
  } catch (e) {
    r = fail(p, `workflow error: ${e.message}`)
  }
  if (r.ok) {
    done.add(p.nr)
    delivered.push({ nr: p.nr, pr: r.pr })
    log(`#${p.nr} delivered: ${r.pr}`)
  } else {
    blocked.push({ nr: p.nr, reason: r.reason, ...(r.pr ? { pr: r.pr } : {}) })
    log(`#${p.nr} blocked: ${r.reason}`)
  }
}

return { status: 'done', delivered, blocked, skipped: sel.skipped }
