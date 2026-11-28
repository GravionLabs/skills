// The tree flow of deliver-lead (ADR 0012): one tree lead starts a leaf lead (`/deliver-lead <leaf>`) for every leaf
// of a Feature, Epic or milestone, flat, never a lead per level, at most `deliver.parallel` at once. `treeStep` is
// stateless and holds no list of leaves: each call asks the gate `next-issue` again and returns one host verb or
// `end`. What a leaf lead says is never read: whether its leaf is delivered is read from the tracker. A milestone
// whose tree is done runs `release-gate` once per run.
//
// Events (profile deliver@2): task `tree` (the run: step `resume`, step `release-gate`, `task.finished` with the
// report in `deliver.report`) and per leaf the task `issue-<n>`: task.started; step.started `lead` (`deliver`: role,
// base, branch, model); deliver.worker (the handle); step.finished `lead` and task.finished (`deliver.stalled`: the
// leaf lead may still work, so it keeps its place until the tracker says the leaf is delivered).
// Resume (`resume`, the first call of a new lead): the events before it are history. The leaf leads of the lead before
// are gone and never waited for; the open leaves are read from the tracker again.
import { nextIssue } from '../../deliver/scripts/gates/next-issue.mts';
import { releaseGate } from '../../deliver/scripts/gates/release-gate.mts';
import { type RunEvent, readRunEvents } from '../../deliver/scripts/gates/limits.mts';
import { UsageError } from '../../deliver/scripts/gates/result.mts';
import { runOrigin } from '../../deliver/scripts/event-dir.mts';
import { isKind } from '../../deliver/scripts/objective.mts';
import { type ConfigLayer, resolveModel } from '../../deliver/scripts/resolve-model.mts';
import { issueTier } from '../../deliver/scripts/session-models.mts';
import type { Leaf, Tracker } from '../../deliver/scripts/tracker.mts';
import {
  BACKOFF_S,
  type ProjectConfig,
  RETRY_LIMIT_S,
  SESSION_BUDGET_S,
  STAGE_TIMEOUT_S,
  type StepResult,
  eventWriter,
} from './leaf.mts';

/** The budget of one leaf lead, which runs several worker sessions: past it the lead no longer waits for it. */
export const LEAD_BUDGET_S = 8 * STAGE_TIMEOUT_S;

/** What the lead executes next: a verb id of host-verbs.md, or `end`. */
export type TreeAction =
  | {
      do: 'start-worker';
      role: 'lead';
      name: string;
      brief: string;
      /** A branch of the leaf lead's own worktree; nothing is committed on it. */
      branch: string;
      /** The branch that worktree starts from. */
      base: string;
      model: string;
      env: Record<string, string>;
    }
  /** No handles: a merged leaf is still open; the lead waits `timeout` seconds and calls the step again. */
  | { do: 'wait-any'; handles: string[]; timeout: number; why?: string }
  | { do: 'read-result'; handle: string; question?: string }
  | { do: 'end'; report: TreeReport };

/** A leaf that is not delivered, and why. */
export type Held = { repo: string; number: number; title: string; reason: string };

export type TreeReport = {
  ref: string;
  /** `done`: no leaf of the tree is open. */
  outcome: 'done' | 'held';
  reason: string;
  /** The leaves this run started that are delivered. */
  delivered: number[];
  waiting: Held[];
  /** A milestone whose tree is done: the word of `release-gate`. */
  release?: {
    result: string;
    reason: string;
    /** The retro comment, when there is one. */
    retro?: string;
    /** No retro yet: the command a person runs (named, not run). */
    retroCommand?: string;
  };
};

export type TreeGates = { nextIssue: typeof nextIssue; releaseGate: typeof releaseGate };

export type TreeInput = {
  /** The tracker of the lead's checkout; for a milestone its selection is that milestone (`release-gate`). */
  tracker: Tracker;
  /** The events directory (event-dir.mts); the run file is `<events>/<run>.jsonl`. */
  events: string | undefined;
  /** The number of a Feature or Epic, or a milestone `M<nnn>`. */
  ref: string;
  run: string;
  result?: StepResult;
  cwd?: string;
  /** The project config of the lead's checkout (`deliver.base`, `deliver.harness`, `deliver.parallel`). */
  config?: ProjectConfig & { deliver?: { parallel?: unknown } };
  layers?: ConfigLayer[];
  gates?: Partial<TreeGates>;
  now?: () => number;
  /** The first call of a new lead for a run: no leaf lead of the lead before is waited for. Never with `result`. */
  resume?: boolean;
};

export const MILESTONE = /^M\d+(\.\d+)*( [^\u0000-\u001f\u007f`]*)?$/;
const RUN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const TREE = 'tree';

type Body = Record<string, unknown>;
const fieldsOf = (event: RunEvent | undefined, key: string): Body =>
  (event?.[key] && typeof event[key] === 'object' ? event[key] : {}) as Body;
const stepName = (event: RunEvent): string => String(fieldsOf(event, 'step').name ?? '');
const seqOf = (event: RunEvent | undefined): number => Number(event?.seq) || 0;
const oneLine = (text: string): string =>
  text
    .replace(/[\u0000-\u001f\u007f-\u009f`<>]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);

/** A leaf lead of this run since the last resume, from its events. */
type Lead = {
  issue: number;
  started: RunEvent;
  worker?: RunEvent;
  finished?: RunEvent;
};

/** The start of a leaf lead, rebuilt from its `step.started`: a repeated call returns the same action. */
function startAction(started: RunEvent): TreeAction {
  const d = fieldsOf(started, 'deliver');
  const issue = Number(d.issue);
  return {
    do: 'start-worker',
    role: 'lead',
    name: String(d.name),
    // a host whose worker is a subagent runs no slash command: the brief names the skill too
    brief: [
      `Lead the delivery of issue #${issue} with the skill \`deliver-lead\`: load that skill and follow it with the input \`/deliver-lead ${issue}\`. Without slash commands, load the skill by its name.`,
      `You are the leaf lead of #${issue} only, in a worktree of your own from ${String(d.base)}: your workers do the work through the host adapter; take no other issue.`,
      'End with the report of the skill.',
    ].join('\n'),
    branch: String(d.branch),
    base: String(d.base),
    model: String(d.model),
    env: {},
  };
}

/**
 * One step of the tree flow: the next action for the tree below `ref` in `run`. Throws for wrong input (the CLI
 * reports `usage`).
 */
export async function treeStep(input: TreeInput): Promise<TreeAction> {
  const { tracker, ref, run, result } = input;
  const number = /^[1-9]\d*$/.test(ref) ? Number(ref) : undefined;
  if (number === undefined && !MILESTONE.test(ref))
    throw new UsageError(`no issue number or milestone M<nnn>: ${ref}`);
  if (!RUN.test(run)) throw new UsageError(`no run id: ${run}`);
  if (!input.events)
    throw new UsageError('no events directory: set AGENT_EVENTS_DIR (the events are the state)');
  if (input.resume && result) throw new UsageError('--resume starts a new lead: no --result');
  const config = input.config ?? {};
  const parallel = Number(config.deliver?.parallel ?? 1);
  if (!Number.isInteger(parallel) || parallel < 1)
    throw new UsageError('deliver.parallel needs a whole number from 1');
  const gates: TreeGates = { nextIssue, releaseGate, ...input.gates };
  const now = input.now ?? Date.now;
  const cwd = input.cwd ?? process.cwd();
  const repo = tracker.repo;
  const root = number === undefined ? undefined : tracker.issue({ repo, number });
  // an Objective adds the order across repositories, which this flow does not cover (#1143)
  if (root && isKind(root, 'objective'))
    throw new UsageError(`#${number} is an Objective: not covered by the tree flow`);
  if (number !== undefined && (!root || !(isKind(root, 'feature') || isKind(root, 'epic'))))
    throw new UsageError(`#${number} is no Feature or Epic of ${repo}`);

  const all = readRunEvents(input.events, run) ?? [];
  const emit = eventWriter(input.events, run, all, now);
  const ofTask = (task: string, type: string) =>
    all.filter((event) => event.task === task && event.type === type);
  const first = ofTask(TREE, 'task.started')[0];
  if (first && fieldsOf(first, 'deliver').ref !== ref)
    throw new UsageError(`run ${run} leads ${String(fieldsOf(first, 'deliver').ref)}, not ${ref}`);
  if (!first && number === undefined && !tracker.leaves(ref))
    throw new UsageError(`${ref} is no milestone of ${repo}`);
  const subject = root
    ? tracker.itemSubject({
        id: root.number,
        title: root.title,
        url: root.url,
        labels: [],
        body: '',
      })
    : tracker.subject();
  if (!all.some((event) => event.type === 'run.started'))
    emit('run.started', { profiles: ['deliver@2'], origin: runOrigin(cwd), subject });
  if (!first) emit('task.started', { task: TREE, subject, deliver: { repo, ref } });

  if (input.resume) {
    const text = 'a new lead resumes the tree from the tracker';
    emit('step.started', { task: TREE, step: { name: 'resume', text } });
    emit('step.finished', { task: TREE, step: { name: 'resume', text } });
  }
  const epoch = seqOf(
    ofTask(TREE, 'step.started')
      .filter((event) => stepName(event) === 'resume')
      .at(-1),
  );
  const ended = ofTask(TREE, 'task.finished').at(-1);
  if (ended && seqOf(ended) > epoch)
    return { do: 'end', report: fieldsOf(ended, 'deliver').report as TreeReport };

  /** The newest leaf lead of each leaf since the resume. */
  const leads = (): Lead[] => {
    const found = new Map<number, Lead>();
    for (const event of all) {
      if (seqOf(event) <= epoch) continue;
      const d = fieldsOf(event, 'deliver');
      const issue = Number(d.issue);
      if (event.type === 'step.started' && stepName(event) === 'lead')
        found.set(issue, { issue, started: event });
      const lead = found.get(issue);
      if (!lead) continue;
      if (event.type === 'deliver.worker') lead.worker = event;
      if (event.type === 'task.finished') lead.finished = event;
    }
    return [...found.values()];
  };

  /** Seconds since an event was written, by the clock of the run. */
  const elapsed = (event: RunEvent): number =>
    Math.max(0, (now() - (Date.parse(String(event.ts ?? '')) || now())) / 1000);

  /** What the tracker says about a leaf now; a leaf lead's word is never asked. */
  const stateOf = (issue: number): 'delivered' | 'merged' | 'dropped' | 'open' => {
    const found = tracker.issue({ repo, number: issue });
    if (found?.state === 'closed')
      return ['not_planned', 'duplicate'].includes(found.stateReason ?? '')
        ? 'dropped'
        : 'delivered';
    const item = { id: issue, title: found?.title ?? '', url: '', labels: [], body: '' };
    return tracker.mergedPullOf(item) ? 'merged' : 'open';
  };

  /** The lead of this leaf is over for this tree lead; `stalled`: it may still work. */
  const close = (lead: Lead, text: string, stalled = false) => {
    const task = `issue-${lead.issue}`;
    const state = stateOf(lead.issue);
    const delivered = state === 'delivered' || state === 'merged';
    emit('step.finished', { task, step: { name: 'lead', text: text.slice(0, 1000) } });
    emit(
      'task.finished',
      {
        task,
        outcome: delivered ? 'succeeded' : 'skipped',
        text: (delivered ? 'delivered' : text).slice(0, 1000),
        deliver: { repo, issue: lead.issue, ...(stalled && { stalled }) },
      },
      delivered ? 'success' : 'warning',
    );
  };

  // the outcome of the previous verb
  const pending = leads().find((lead) => !lead.worker && !lead.finished);
  if (pending) {
    const name = String(fieldsOf(pending.started, 'deliver').name);
    const known = all.some(
      (event) =>
        event.type === 'deliver.worker' && fieldsOf(event, 'deliver').handle === result?.handle,
    );
    // a handle is taken only as the answer to this start, never one the run knows already
    const startAnswer =
      result?.handle !== undefined &&
      !known &&
      result.state === undefined &&
      result.report === undefined &&
      result.answer === undefined &&
      (result.name === undefined || result.name === name);
    if (startAnswer)
      emit('deliver.worker', {
        deliver: { repo, issue: pending.issue, role: 'lead', step: 'lead', handle: result!.handle },
      });
    // a refused start names its worker: a repeated call never refuses the next leaf
    else if (!result?.handle && result?.error && result.name === name)
      close(pending, `the leaf lead did not start: ${oneLine(result.error)}`);
    else if (elapsed(pending.started) >= SESSION_BUDGET_S)
      close(
        pending,
        `the leaf lead did not start: no handle within ${SESSION_BUDGET_S / 60} min`,
        // an answer that was never understood may have started it
        result?.handle !== undefined,
      );
    else return startAction(pending.started);
  } else if (result?.handle !== undefined) {
    const lead = leads().find(
      (one) => !one.finished && fieldsOf(one.worker, 'deliver').handle === result.handle,
    );
    if (lead) {
      const left = LEAD_BUDGET_S - elapsed(lead.worker!);
      if (result.answer === 'owner')
        close(
          lead,
          `its leaf lead asks what only the owner answers: ${JSON.stringify(oneLine(result.question ?? 'no question given'))}`,
          true,
        );
      else if (result.answer === undefined) {
        // the report is a claim and is not read: the tracker says whether the leaf is delivered
        if (result.report !== undefined)
          close(lead, 'its leaf lead ended and the issue is not delivered');
        else if (result.state === 'done') return { do: 'read-result', handle: result.handle };
        else if (result.state === 'blocked' && left > 0)
          return {
            do: 'read-result',
            handle: result.handle,
            question: result.question ?? 'no question given',
          };
        else if (result.state === 'error' || result.state === 'gone')
          close(lead, `its leaf lead ended without a result (${result.state})`);
      }
    }
  }
  for (const lead of leads())
    if (lead.worker && !lead.finished && elapsed(lead.worker) >= LEAD_BUDGET_S)
      close(lead, `its leaf lead did not end within ${LEAD_BUDGET_S / 60} min`, true);

  const mine = leads();
  const states = new Map(mine.map((lead) => [lead.issue, stateOf(lead.issue)]));
  const running = mine.filter((lead) => !lead.finished);
  const stalled = mine.filter(
    (lead) =>
      fieldsOf(lead.finished, 'deliver').stalled === true && states.get(lead.issue) === 'open',
  );

  /** Merged and still open: the tracker closes it a moment after the merge. */
  const merged: Held[] = [];
  const skip = new Set<number>(states.keys());
  const same = (other: string | undefined) => (other ?? repo).toLowerCase() === repo.toLowerCase();
  /** The tracker as `next-issue` reads it, without the leaves this lead has taken already. */
  const view: Parameters<typeof nextIssue>[0]['tracker'] = {
    repo,
    leaves: (of) =>
      tracker
        .leaves(of)
        ?.filter((leaf) => !(same(leaf.repo) && skip.has(leaf.id)))
        .map((leaf: Leaf) => {
          const held = !same(leaf.repo)
            ? 'in another repository: not delivered by this tree'
            : leaf.labels.includes('agent:handover')
              ? 'handed over (agent:handover): a person decides'
              : undefined;
          return held ? { ...leaf, held: leaf.held ?? held } : leaf;
        }),
    waitReason: (item) => tracker.waitReason(item),
  };
  /** The next ready leaf that is not merged yet, and every held one, as the tracker says now. */
  const next = () => {
    for (;;) {
      const { evidence } = gates.nextIssue({ tracker: view, ref });
      const found = evidence.issue as (Omit<Held, 'reason'> & { tier: string }) | null;
      if (!found) return { found: undefined, waiting: (evidence.waiting ?? []) as Held[] };
      const item = { id: found.number, title: found.title, url: '', labels: [], body: '' };
      if (!tracker.mergedPullOf(item)) return { found, waiting: [] as Held[] };
      const { tier: _, ...leaf } = found;
      merged.push({ ...leaf, reason: 'merged, the issue is still open' });
      skip.add(found.number);
    }
  };

  let waiting: Held[] = [];
  if (running.length + stalled.length < parallel) {
    const picked = next();
    if (picked.found) {
      const { number: issue, title, tier } = picked.found;
      const task = `issue-${issue}`;
      const before = all.filter(
        (event) => event.task === task && event.type === 'step.started',
      ).length;
      const attempt = before > 0 ? `-try-${before + 1}` : '';
      const name = `issue-${issue}-lead${attempt}`;
      const base = config.deliver?.base ?? 'release/next';
      const model = resolveModel({
        role: 'implement',
        issueTier: issueTier(`Tier: ${tier}`).tier,
        harness: config.deliver?.harness,
        layers: input.layers ?? [],
      }).model;
      emit('task.started', {
        task,
        subject: tracker.itemSubject({ id: issue, title, url: '', labels: [], body: '' }),
      });
      emit('step.started', {
        task,
        step: { name: 'lead', text: `leaf lead starts for #${issue}` },
        deliver: {
          repo,
          issue,
          role: 'lead',
          name,
          // never `<type>/<nr>-…`: that is how the tracker finds the pull request of an issue
          branch: `lead/${name}-${run.replace(/[^A-Za-z0-9]/g, '').slice(-8)}`,
          base,
          model,
        },
      });
      return startAction(all.at(-1)!);
    }
    waiting = picked.waiting;
  }

  if (running.length > 0) {
    const left = Math.min(...running.map((lead) => LEAD_BUDGET_S - elapsed(lead.worker!)));
    return {
      do: 'wait-any',
      handles: running.map((lead) => String(fieldsOf(lead.worker, 'deliver').handle)),
      timeout: Math.max(60, Math.min(STAGE_TIMEOUT_S, Math.ceil(left))),
    };
  }

  // nothing runs: the stalled leads hold every place, or no leaf is ready
  if (stalled.length >= parallel) {
    for (let picked = next(); ; picked = next()) {
      if (!picked.found) {
        waiting.push(...picked.waiting);
        break;
      }
      const { tier: _, ...leaf } = picked.found;
      const reason = 'not started: a leaf lead that may still work holds its place';
      waiting.push({ ...leaf, reason });
      skip.add(leaf.number);
    }
  }
  const open = new Map(
    (tracker.leaves(ref) ?? []).filter((leaf) => same(leaf.repo)).map((leaf) => [leaf.id, leaf]),
  );
  for (const lead of mine) {
    const state = states.get(lead.issue);
    if (state !== 'open' && state !== 'merged') continue;
    const leaf = { repo, number: lead.issue, title: open.get(lead.issue)?.title ?? '' };
    if (state === 'open') waiting.push({ ...leaf, reason: String(lead.finished?.text ?? '') });
    else if (open.has(lead.issue))
      merged.push({ ...leaf, reason: 'merged, the issue is still open' });
  }
  if (merged.length > 0) {
    // blocked leaves follow once the tracker has closed what is merged
    const waited = elapsed(all.at(-1)!);
    if (waited < RETRY_LIMIT_S)
      return {
        do: 'wait-any',
        handles: [],
        timeout: Math.min(BACKOFF_S.max, Math.max(BACKOFF_S.min, Math.round(waited / 2))),
        why: `merged, still open: ${merged.map((leaf) => `#${leaf.number}`).join(', ')}`,
      };
    waiting.push(...merged);
  }

  /** The leaves any lead of this run started that the tracker calls delivered now. */
  const delivered = [
    ...new Set(
      all
        .filter((event) => event.type === 'step.started' && stepName(event) === 'lead')
        .map((event) => Number(fieldsOf(event, 'deliver').issue)),
    ),
  ].filter(
    (issue) =>
      !waiting.some((leaf) => same(leaf.repo) && leaf.number === issue) &&
      ['delivered', 'merged'].includes(stateOf(issue)),
  );
  const report: TreeReport = {
    ref,
    outcome: waiting.length ? 'held' : 'done',
    reason: waiting.length
      ? `nothing below ${ref} is ready: ${waiting.length} held`
      : `no open PBI or Bug below ${ref}`,
    delivered,
    waiting,
  };
  if (number === undefined && waiting.length === 0) report.release = release();
  emit(
    'task.finished',
    {
      task: TREE,
      outcome: waiting.length ? 'skipped' : 'succeeded',
      text: report.reason,
      deliver: { repo, ref, report },
    },
    waiting.length ? 'warning' : 'success',
  );
  return { do: 'end', report };

  /** `release-gate`, once per run: a later call or lead takes the result recorded in the events. */
  function release(): NonNullable<TreeReport['release']> {
    const recorded = ofTask(TREE, 'step.finished').find(
      (event) => stepName(event) === 'release-gate',
    );
    if (recorded)
      return fieldsOf(recorded, 'deliver').release as NonNullable<TreeReport['release']>;
    const gate = gates.releaseGate({ tracker, milestone: ref });
    const { retroDone, retro } = gate.evidence;
    const name = /\s/.test(ref) ? JSON.stringify(ref) : ref;
    const found = {
      result: gate.result,
      reason: gate.reason,
      ...(retro && { retro }),
      ...(retroDone === false && { retroCommand: `/retro --milestone ${name} --post` }),
    };
    emit('step.started', {
      task: TREE,
      step: { name: 'release-gate', text: `release-gate ${ref}` },
    });
    emit('step.finished', {
      task: TREE,
      step: { name: 'release-gate', text: `release-gate: ${gate.result}` },
      deliver: { repo, release: found },
    });
    return found;
  }
}
