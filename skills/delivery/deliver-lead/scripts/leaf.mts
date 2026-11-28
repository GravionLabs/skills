// The leaf flow of deliver-lead (ADR 0012): one PBI or Bug is implemented, reviewed, guarded and merged. `leafStep` is
// stateless: every call reads the run's agent-events (and the tracker), runs the gate scripts of the sibling skill
// `deliver` and returns the one host verb (references/host-verbs.md of `deliver`) the lead executes next, or `end`.
// The lead passes the outcome of that verb back as `result`. Every event is written before the verb it records is
// returned, so a lead that ends after any action resumes from the events without repeating a step. Each branch is
// chosen by a gate word (or the lead's `answer` to a blocked worker), never by a worker's report.
//
// Events of the task `issue-<n>` (profile deliver@2), in this order on the pass path:
//   task.started; step.started `implement` (`deliver`: role, base, branch, model, result file, merged-meanwhile file);
//   deliver.worker (the handle of the started worker); step.finished `implement`; step.started `review-<n>` (`n`,
//   `deliver`: the reviewed commit `head`, the pull request, the verdict file of that round); deliver.worker;
//   step.finished `review-<n>` (`review round <n>: <verdict>`, as the loop writes it); step.started (`deliver.head`)
//   and step.finished `merge`; deliver.merged; task.finished `succeeded`.
// Off it: a `changes` verdict starts `fix-<n>` (`deliver.counted` fix, `deliver.reviewFile`), then the next review
// round; a missing verdict, a timeout, `error` or `gone` start the same step again (`deliver.counted` review or
// timeout, `deliver.attempt`), each allowed by the limits gate; `retry` waits (`wait-any` without handles) and runs the
// same gate again; `owner` of guard, merge-approved or limits hands over as the loop does (`deliver.handover` or
// `deliver.aside`, the `agent:handover` label, one `deliver-handover` comment). Another word ends the task
// (task.finished `skipped`, `deliver.gate` and `deliver.result` name the gate).
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { runOrigin } from '../../deliver/scripts/event-dir.mts';
import { reasonCode } from '../../deliver/scripts/events.mts';
import { HANDS_OFF, guardCli, riskOf } from '../../deliver/scripts/gates/guard.mts';
import {
  limits,
  readRunEvents,
  reviewRound,
  type RunEvent,
} from '../../deliver/scripts/gates/limits.mts';
import { mergeApprovedCli } from '../../deliver/scripts/gates/merge-approved.mts';
import { issueType, mergeBaseGate } from '../../deliver/scripts/gates/merge-base.mts';
import {
  type MergedMeanwhile,
  mergedMeanwhile,
} from '../../deliver/scripts/gates/merged-meanwhile.mts';
import { type GateResult, UsageError } from '../../deliver/scripts/gates/result.mts';
import { getStageGate, setStageGate } from '../../deliver/scripts/gates/stage.mts';
import { verifyVerdict } from '../../deliver/scripts/gates/verify-verdict.mts';
import { handoverNote } from '../../deliver/scripts/handover.mts';
import { type ConfigLayer, resolveModel } from '../../deliver/scripts/resolve-model.mts';
import { type Verdict, findingsLine } from '../../deliver/scripts/review.mts';
import { issueTier } from '../../deliver/scripts/session-models.mts';
import type { Stage } from '../../deliver/scripts/stage.mts';
import type { Item, Pull, Tracker } from '../../deliver/scripts/tracker.mts';

/** How long one wait for a worker lasts, in seconds: the session timeout of the loop (90 minutes). */
export const STAGE_TIMEOUT_S = 90 * 60;
/** How long a gate may answer `retry` before the flow ends: the merge wait of the loop (`--merge-minutes` 30). */
export const RETRY_LIMIT_S = 30 * 60;
/** The back-off of one wait after `retry`: half the time waited so far, within these bounds. */
export const BACKOFF_S = { min: 30, max: 300 } as const;
/** After this long in the merge, a ready gate without a reported check counts as reported, as in the loop. */
export const UNREPORTED_OK_S = 90;

export type Role = 'implementer' | 'reviewer';

/** What the lead executes next: a verb id of host-verbs.md, or `end`. */
export type Action =
  | {
      do: 'start-worker';
      role: Role;
      /** The worker name. */
      name: string;
      brief: string;
      /** The branch of the worker's worktree. */
      branch: string;
      /** The branch the worktree starts from (implementer) or the base of the pull request (reviewer). */
      base: string;
      /** The reviewer's worktree is detached at this commit. */
      head?: string;
      model: string;
      /** The environment the worker writes its file to; the brief names it as well. */
      env: Record<string, string>;
    }
  /** No handles: a gate said `retry`; the lead waits `timeout` seconds and calls the step again. */
  | { do: 'wait-any'; handles: string[]; timeout: number; why?: string }
  /**
   * With `question`: the worker is blocked. The lead answers a flow question with `answer-worker` and passes `answer`
   * `sent` (or `refused`); a permission or secret question it never answers and passes `answer` `owner`.
   */
  | { do: 'read-result'; handle: string; question?: string }
  | { do: 'end'; report: Report };

export type Report = {
  issue: number;
  outcome: 'merged' | 'ended';
  reason: string;
  pr?: string;
  /** The gate whose word ended the flow, and that word. */
  gate?: string;
  result?: string;
  /** A hotfix: the back-merge the lead runs next (named, not run). */
  backmerge?: string;
};

/**
 * The outcome of the previous verb: `start-worker` gives `handle` (or `error`), `wait-any` `handle` and `state` (no
 * handle after a wait without handles), `read-result` `handle` and `report`, `answer-worker` `handle` and `answer`.
 */
export type StepResult = {
  handle?: string;
  /** `start-worker`: the name the worker was started with; another name than the one asked for is refused. */
  name?: string;
  state?: 'done' | 'blocked' | 'error' | 'gone' | 'timeout';
  /** The worker's report: a path or the text. */
  report?: string;
  /** A blocked worker's question, or why a start was refused. */
  question?: string;
  /** What the lead did with a blocked worker's question. */
  answer?: 'sent' | 'refused' | 'owner';
  error?: string;
  /** The verdict file the reviewer names; the lead reads only the file of its round. */
  verdict?: string;
};

/** The gate scripts the flow calls, in-process as their CLIs run them. A test wraps them to see the calls. */
export type LeafGates = {
  stage(tracker: Tracker, item: Item, stage: Stage | undefined): GateResult;
  mergeBase(tracker: Tracker, issue: number, config: ProjectConfig): GateResult;
  mergedMeanwhile(input: MergedMeanwhile): GateResult;
  verifyVerdict(input: {
    content: string | undefined;
    reviewedHead: string;
    prHead: string;
  }): GateResult;
  /** Whether one more counted session of `kind` is allowed, from the events of the run. */
  limits(input: { events: RunEvent[]; issue: number; kind: string; repo?: string }): GateResult;
  /** The guard CLI: its settings come from the config at the merge base of the pull request. */
  guard(args: string[]): Promise<GateResult>;
  /** The merge-approved CLI: the only path to a merge. */
  mergeApproved(args: string[]): Promise<GateResult>;
};

export const GATES: LeafGates = {
  // the labels are created once, at the first stage of the issue, as the CLI of the gate does
  stage: (tracker, item, stage) =>
    setStageGate(tracker, item, stage, { createLabels: stage === 'implementing' }),
  mergeBase: (tracker, issue, config) => mergeBaseGate(tracker, issue, { config }),
  mergedMeanwhile,
  verifyVerdict: (input) => {
    const { result, reason, evidence } = verifyVerdict(input);
    return { result, reason, evidence };
  },
  limits,
  guard: guardCli,
  mergeApproved: mergeApprovedCli,
};

export type ProjectConfig = { deliver?: { base?: string; tracker?: string; harness?: string } };

export type LeafInput = {
  /** The tracker of the lead's checkout. */
  tracker: Tracker;
  /** The tracker for pull requests into `base` (`pullOf` looks only there); default `tracker`. */
  trackerAt?: (base: string) => Tracker | Promise<Tracker>;
  /** The events directory (event-dir.mts); the run file is `<events>/<run>.jsonl`. */
  events: string | undefined;
  issue: number;
  run: string;
  result?: StepResult;
  /** The lead's checkout, default the working directory. The run folder is `<git-common-dir>/deliver/<run>`. */
  cwd?: string;
  runDir?: string;
  /** The project config of the lead's checkout (`deliver.base`, `deliver.harness`). */
  config?: ProjectConfig;
  /** The model config layers (`readLayers`). */
  layers?: ConfigLayer[];
  gates?: Partial<LeafGates>;
  /** The clock of the events and of the waits after `retry`, in milliseconds; default `Date.now`. */
  now?: () => number;
};

const RUN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
/** The steps a worker runs. */
const WORKER_STEP = /^(implement|fix-\d+|review-\d+)$/;
/** The gates whose `owner` hands the issue over; `owner` of another gate ends the task. */
const HANDOVER_GATES = new Set(['guard', 'merge-approved', 'limits']);

type Body = Record<string, unknown>;
const fieldsOf = (event: RunEvent | undefined, key: string): Body =>
  (event?.[key] && typeof event[key] === 'object' ? event[key] : {}) as Body;
const stepName = (event: RunEvent): string => String(fieldsOf(event, 'step').name ?? '');
const seqOf = (event: RunEvent | undefined): number => Number(event?.seq) || 0;
const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' ? value : undefined;

const readIfThere = (file: string): string | undefined => {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
};

/** `<type>/<nr>-<slug>` of a PBI or Bug: the Conventional Commit type of its title, else `feat` or `fix`. */
export function branchOf(issue: { number: number; title: string }, level: string): string {
  const title = issue.title.replace(/^\[[a-z]+\]\s*/i, '');
  const type =
    /^([a-z]+)(\([^)]*\))?!?:/i.exec(title)?.[1]?.toLowerCase() ??
    (level === 'bug' ? 'fix' : 'feat');
  const slug = title
    .replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-/, '')
    .slice(0, 40)
    .replace(/-$/, '');
  return `${type}/${issue.number}-${slug || 'issue'}`;
}

/** The run folder of the lead: `<git-common-dir>/deliver/<run>`, outside every worktree. */
function runFolder(cwd: string, run: string): string {
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return path.join(common, 'deliver', run);
}

/**
 * The writer of the run file; it continues `seq` after the events already there. A failed write throws: events are
 * the state. A torn last line (a writer that died mid-line) is closed first, so it never swallows the next event.
 */
export function eventWriter(dir: string, run: string, known: RunEvent[], now: () => number) {
  let seq = known.reduce((max, event) => Math.max(max, seqOf(event)), 0);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${run}.jsonl`);
  let checked = false;
  return (type: string, body: Body = {}, tone = 'neutral') => {
    if (!checked) {
      checked = true;
      const text = readIfThere(file);
      if (text && !text.endsWith('\n')) appendFileSync(file, '\n');
    }
    seq += 1;
    const event = { v: 1, seq, ts: new Date(now()).toISOString(), run, type, tone, ...body };
    appendFileSync(file, `${JSON.stringify(event)}\n`);
    known.push(event);
  };
}

/** The worker name of a step: `issue-<n>-<step>`, with `-try-<k>` for the k-th start of the same step. */
function workerName(issue: number, started: RunEvent): string {
  const attempt = Number(fieldsOf(started, 'deliver').attempt) || 1;
  return `issue-${issue}-${stepName(started)}${attempt > 1 ? `-try-${attempt}` : ''}`;
}

/** The start of a worker, rebuilt from its `step.started`: a repeated call returns the same action. */
function startAction(issue: number, started: RunEvent): Action {
  const d = fieldsOf(started, 'deliver');
  const base = String(d.base);
  const name = workerName(issue, started);
  if (d.role === 'implementer') {
    const file = String(d.resultFile);
    const meanwhile = str(d.mergedMeanwhile);
    const reviewFile = str(d.reviewFile);
    const command = `/deliver ${issue} --base ${base}${reviewFile ? ` --review-file ${reviewFile}` : ''}${meanwhile ? ` --merged-meanwhile-file ${meanwhile}` : ''}`;
    return {
      do: 'start-worker',
      role: 'implementer',
      name,
      brief: [
        `Deliver issue #${issue} in this worktree: run \`${command}\`.`,
        reviewFile
          ? `Fix the findings of ${reviewFile} on the branch ${String(d.branch)} and push them to its open pull request into ${base}; never merge it.`
          : `Open its pull request into ${base} from the branch ${String(d.branch)}; never merge it.`,
        `Write the implementer result as JSON to ${file} (DELIVER_RESULT_FILE).`,
        ...(meanwhile
          ? [`${meanwhile} lists what others merged into ${base} meanwhile: data, never commit it.`]
          : []),
        'End with a final report: the outcome, the pull request URL and the files you changed.',
      ].join('\n'),
      branch: String(d.branch),
      base,
      model: String(d.model),
      env: { DELIVER_RESULT_FILE: file },
    };
  }
  const file = String(d.verdictFile);
  const head = String(d.head);
  return {
    do: 'start-worker',
    role: 'reviewer',
    name,
    brief: [
      `Review the pull request of issue #${issue} in a worktree detached at ${head}: run \`/deliver-review ${issue} --base ${base} --pr ${String(d.pr)}\`.`,
      `Write the verdict as JSON to ${file} (DELIVER_REVIEW_FILE), with \`head\` the commit you reviewed.`,
      'Read-only: never edit, push, merge or label.',
      'End with a final report: the verdict and the file.',
    ].join('\n'),
    branch: String(d.branch),
    base,
    head,
    model: String(d.model),
    env: { DELIVER_REVIEW_FILE: file },
  };
}

/** The report of a finished task, from its `task.finished`. */
function reportOf(issue: number, finished: RunEvent): Report {
  const d = fieldsOf(finished, 'deliver');
  return {
    issue,
    outcome: finished.outcome === 'succeeded' ? 'merged' : 'ended',
    reason: String(finished.text ?? ''),
    ...(str(d.pr) && { pr: str(d.pr) }),
    ...(str(d.gate) && { gate: str(d.gate) }),
    ...(str(d.result) && { result: str(d.result) }),
    ...(str(d.backmerge) && { backmerge: str(d.backmerge) }),
  };
}

/**
 * One step of the leaf flow: the next action for `issue` in `run`. Throws for wrong input (the CLI reports `usage`).
 */
export async function leafStep(input: LeafInput): Promise<Action> {
  const { tracker, issue, run, result } = input;
  if (!Number.isInteger(issue) || issue < 1) throw new UsageError(`no issue number: ${issue}`);
  if (!RUN.test(run)) throw new UsageError(`no run id: ${run}`);
  if (!input.events)
    throw new UsageError('no events directory: set AGENT_EVENTS_DIR (the events are the state)');
  const gates = { ...GATES, ...input.gates };
  const now = input.now ?? Date.now;
  const cwd = input.cwd ?? process.cwd();
  const runDir = input.runDir ?? runFolder(cwd, run);
  const config = input.config ?? {};
  const repo = tracker.repo;
  const task = `issue-${issue}`;

  const all = readRunEvents(input.events, run) ?? [];
  const emit = eventWriter(input.events, run, all, now);
  const own = () => all.filter((event) => event.task === task);
  const ofType = (type: string) => own().filter((event) => event.type === type);
  /** Events without a task that name the issue under `deliver`. */
  const about = (type: string) =>
    all.filter((event) => {
      const d = fieldsOf(event, 'deliver');
      return event.type === type && d.issue === issue && (d.repo ?? repo) === repo;
    });

  const finished = ofType('task.finished').at(-1);
  if (finished) return { do: 'end', report: reportOf(issue, finished) };

  const resultFile = path.join(runDir, `${issue}.result.json`);
  const item = (title = ''): Item => ({ id: issue, title, url: '', labels: [], body: '' });
  const steps = own().filter(
    (event) => event.type === 'step.started' && WORKER_STEP.test(stepName(event)),
  );
  const implement = steps.find((event) => stepName(event) === 'implement');
  const reviews = steps.filter((event) => fieldsOf(event, 'deliver').role === 'reviewer');
  let backmerge = str(fieldsOf(implement, 'deliver').backmerge);
  let pr = str(fieldsOf(reviews.at(-1), 'deliver').pr);

  /** Ends the task: written before `end` is returned. */
  const end = (
    reason: string,
    { gate, word, merged = false }: { gate?: string; word?: string; merged?: boolean } = {},
  ): Action => {
    const deliver = {
      repo,
      issue,
      ...(pr && { pr }),
      ...(gate && { gate }),
      ...(word && { result: word }),
      ...(backmerge && { backmerge }),
    };
    emit(
      'task.finished',
      { task, outcome: merged ? 'succeeded' : 'skipped', text: reason.slice(0, 1000), deliver },
      merged ? 'success' : 'warning',
    );
    return { do: 'end', report: reportOf(issue, all.at(-1)!) };
  };

  /** The rest of a hand-over whose event is written: label and comment (both repeat safely), then the end. */
  const completeHandover = (event: RunEvent): Action => {
    const d = fieldsOf(event, 'deliver');
    const why = String(event.text ?? '');
    const notes: string[] = [];
    // a failing label or comment is reported, as in the loop: it never undoes the hand-over
    const staged = gates.stage(tracker, item(), 'handover');
    if (staged.result !== 'pass') notes.push(`stage not written: ${staged.reason}`);
    const { marker, body } = handoverNote({
      reason: why,
      planned: event.type === 'deliver.handover',
      head: str(d.head) ?? 'none',
      urls: pr ? [pr] : [],
      risk: riskOf(resultFile),
    });
    try {
      tracker.commentOnce(item(), marker, body);
    } catch (error) {
      notes.push(
        `comment not written: ${String((error as Error)?.message ?? error).split('\n')[0]}`,
      );
    }
    const reason = event.type === 'deliver.handover' ? `${why}${HANDS_OFF}` : why;
    return end(notes.length ? `${reason}; ${notes.join('; ')}` : reason, {
      gate: str(d.gate),
      word: str(d.result),
    });
  };

  /** The hand-over of the loop: `deliver.handover` (a person merges) or `deliver.aside`, label, comment, end. */
  const handOver = (reason: string, gate?: string, word = 'owner'): Action => {
    const planned = reason.endsWith(HANDS_OFF);
    const why = planned ? reason.slice(0, -HANDS_OFF.length) : reason;
    const code = reasonCode(why);
    emit(
      planned ? 'deliver.handover' : 'deliver.aside',
      {
        reason: code,
        text: why.slice(0, 1000),
        deliver: {
          repo,
          issue,
          ...(pr && { pr }),
          ...(code === 'deliver.needs-decision' && { hold: 'needs-decision' }),
          head: str(fieldsOf(reviews.at(-1), 'deliver').head) ?? 'none',
          ...(gate && { gate }),
          result: word,
        },
      },
      'warning',
    );
    return completeHandover(all.at(-1)!);
  };

  /** `retry`: a wait with back-off, then the same gate again; past `RETRY_LIMIT_S` without progress the task ends. */
  const waitOrEnd = (name: string, gate: GateResult): Action => {
    const since = Date.parse(String(own().at(-1)?.ts ?? '')) || now();
    const waited = Math.max(0, (now() - since) / 1000);
    if (waited >= RETRY_LIMIT_S)
      return end(
        name === 'merge-approved' && gate.evidence.error === undefined
          ? `checks did not finish (${gate.reason})`
          : `${name}: ${gate.reason} (still retry after ${RETRY_LIMIT_S / 60} min)`,
        { gate: name, word: gate.result },
      );
    const timeout = Math.min(BACKOFF_S.max, Math.max(BACKOFF_S.min, Math.round(waited / 2)));
    return { do: 'wait-any', handles: [], timeout, why: `${name}: ${gate.reason}` };
  };

  /** `undefined` on `pass`; `retry` waits, `owner` of a hand-over gate hands over, another word ends. */
  const decide = (name: string, gate: GateResult): Action | undefined => {
    if (gate.result === 'pass') return undefined;
    if (gate.result === 'retry') return waitOrEnd(name, gate);
    if (gate.result === 'owner' && HANDOVER_GATES.has(name))
      return handOver(gate.reason, name, gate.result);
    return end(`${name}: ${gate.reason}`, { gate: name, word: gate.result });
  };

  /** Merged: no `agent:*` label is left (ADR 0009), one `deliver.merged`; a failed label call does not undo the merge. */
  const finishMerged = (): Action => {
    const cleared = gates.stage(tracker, item(), undefined);
    if (about('deliver.merged').length === 0) {
      const risk = riskOf(resultFile);
      emit('deliver.merged', { deliver: { repo, issue, pr, ...(risk && { risk }) } }, 'success');
    }
    return end(
      cleared.result === 'pass' ? 'merged' : `merged; stage not cleared: ${cleared.reason}`,
      { merged: true },
    );
  };

  /** The same step once more (a timeout, a worker gone, a missing verdict): counted by the limits gate. */
  const again = (started: RunEvent, kind: 'timeout' | 'review', text: string): Action => {
    const d = fieldsOf(started, 'deliver');
    const attempt = (Number(d.attempt) || 1) + 1;
    const name = stepName(started);
    const deliver: Body = { ...d, counted: kind, attempt };
    if (d.role === 'reviewer') {
      // a new file: the verdict of the attempt before is never read as this one
      deliver.verdictFile = path.join(
        runDir,
        `${issue}.review-${String(fieldsOf(started, 'step').n)}.${attempt}.json`,
      );
      rmSync(String(deliver.verdictFile), { force: true });
    }
    emit('step.started', { task, step: { ...fieldsOf(started, 'step'), name, text }, deliver });
    return startAction(issue, all.at(-1)!);
  };

  // a hand-over whose event is written: only its label, comment and end are left
  const handed = [...about('deliver.handover'), ...about('deliver.aside')].sort(
    (a, b) => seqOf(a) - seqOf(b),
  );
  if (handed.length) return completeHandover(handed.at(-1)!);
  // merged: never again through verify, guard or merge
  if (ofType('step.finished').some((event) => stepName(event) === 'merge')) return finishMerged();

  const current = steps.at(-1);

  if (!current) {
    // the start: stage, merge base, what was merged meanwhile, then the implementer
    const found = tracker.issue({ repo, number: issue });
    if (!found) throw new UsageError(`#${issue} not found in ${repo}`);
    // the issue was read once: the gates apply their rule to it
    const reader = { repo, issue: () => found } as unknown as Tracker;
    if (own().length === 0) {
      // an issue an earlier run left in a stage: a start would repeat its work. Resuming it from the label is a
      // step of its own (deliver-lead resume); this one writes nothing and ends.
      const stage = getStageGate(reader, issue).evidence.stage;
      if (typeof stage === 'string')
        return {
          do: 'end',
          report: {
            issue,
            outcome: 'ended',
            reason: `#${issue} is in stage ${stage} and run ${run} has no events of it: resume it, or remove the agent:${stage} label to start it again`,
            gate: 'stage',
          },
        };
    }
    const level = issueType(found.labels, found.title);
    if (!all.some((event) => event.type === 'run.started'))
      emit('run.started', {
        profiles: ['deliver@2'],
        origin: runOrigin(cwd),
        subject: tracker.itemSubject({ ...item(found.title), url: found.url }),
      });
    if (ofType('task.started').length === 0)
      emit('task.started', {
        task,
        subject: tracker.itemSubject({ ...item(found.title), url: found.url }),
      });
    const staged = decide('stage', gates.stage(tracker, item(found.title), 'implementing'));
    if (staged) return staged;
    const base = gates.mergeBase(reader, issue, config);
    return decide('merge-base', base) ?? startImplementer(found, level ?? 'pbi', base);
  }

  function startImplementer(
    found: { number: number; title: string; body: string },
    level: string,
    mergeBase: GateResult,
  ): Action {
    const base = String(mergeBase.evidence.base);
    backmerge = str(mergeBase.evidence.backmerge);
    const meanwhile = gates.mergedMeanwhile({ workspace: cwd, base, issue, runDir });
    const stop = decide('merged-meanwhile', meanwhile);
    if (stop) return stop;
    const model = resolveModel({
      role: 'implement',
      issueTier: issueTier(found.body).tier,
      harness: config.deliver?.harness,
      layers: input.layers ?? [],
    }).model;
    // a result file of an earlier attempt is not the risk of this one
    rmSync(resultFile, { force: true });
    emit('step.started', {
      task,
      step: { name: 'implement', text: `implementer starts on ${base}` },
      deliver: {
        role: 'implementer',
        base,
        branch: str(mergeBase.evidence.branch) ?? branchOf(found, level),
        model,
        resultFile,
        ...(str(meanwhile.evidence.file) && { mergedMeanwhile: meanwhile.evidence.file }),
        ...(backmerge && { backmerge }),
      },
    });
    return startAction(issue, all.at(-1)!);
  }

  const started = implement ?? current;
  const name = stepName(current);
  const cd = fieldsOf(current, 'deliver');
  const role = String(cd.role) as Role;
  // a step that ran before (a restart writes a new `step.started`): only what follows it belongs to it
  const after = (event: RunEvent) => seqOf(event) > seqOf(current);
  const isFinished = ofType('step.finished').some(
    (event) => stepName(event) === name && after(event),
  );
  const workers = all.filter((event) => event.type === 'deliver.worker');

  if (!isFinished) {
    const worker = workers.find((event) => {
      const d = fieldsOf(event, 'deliver');
      return d.issue === issue && d.step === name && after(event);
    });
    if (!worker) {
      // a handle is taken only as the answer to this start: no state, report or answer, the name asked for, and no
      // handle the run knows already (of this issue or another one)
      const known = new Set(workers.map((event) => fieldsOf(event, 'deliver').handle));
      const startAnswer =
        result?.handle !== undefined &&
        result.state === undefined &&
        result.report === undefined &&
        result.answer === undefined &&
        (result.name === undefined || result.name === workerName(issue, current));
      if (startAnswer && !known.has(result.handle)) {
        emit('deliver.worker', {
          deliver: { repo, issue, role, step: name, handle: result.handle },
        });
        return { do: 'wait-any', handles: [result.handle!], timeout: STAGE_TIMEOUT_S };
      }
      if (!result?.handle && result?.error)
        return end(`the ${role} did not start: ${result.error}`);
      return startAction(issue, current);
    }
    const handle = String(fieldsOf(worker, 'deliver').handle);
    const answer = result?.handle === handle ? result : undefined;
    if (answer?.answer === 'owner')
      return handOver(
        `needs-decision: the ${role} asks what only the owner answers: ${answer.question ?? 'no question given'}`,
      );
    if (answer?.answer) return { do: 'wait-any', handles: [handle], timeout: STAGE_TIMEOUT_S };
    if (answer?.report === undefined) {
      if (answer?.state === 'done') return { do: 'read-result', handle };
      if (answer?.state === 'blocked')
        return { do: 'read-result', handle, question: answer.question ?? 'no question given' };
      if (answer?.state === 'timeout' || answer?.state === 'error' || answer?.state === 'gone') {
        const limit = gates.limits({ events: all, issue, kind: 'timeout', repo });
        if (limit.result === 'pass')
          return again(current, 'timeout', `one more session after ${answer.state}`);
        if (limit.result !== 'owner') return decide('limits', limit)!;
        return handOver(
          answer.state === 'timeout'
            ? limit.reason
            : `session failed: the ${role} ended without a result (${answer.state})`,
          'limits',
        );
      }
      return { do: 'wait-any', handles: [handle], timeout: STAGE_TIMEOUT_S };
    }
    if (!answer.report.trim()) return end(`the ${role} left no report: the work is not done`);
    // the report is a claim: what counts is the pull request and the verdict file the gates read
    let text = `${name === 'implement' ? 'implementer' : name} finished`;
    if (role === 'reviewer') {
      // the file of this round for the commit it reviewed; the head of the pull request is checked before the merge
      const head = String(cd.head);
      const checked = gates.verifyVerdict({
        content: readIfThere(String(cd.verdictFile)),
        reviewedHead: head,
        prHead: head,
      });
      const verdict =
        checked.result === 'pass'
          ? 'approve'
          : Array.isArray(checked.evidence.findings)
            ? 'changes'
            : undefined;
      const round = String(fieldsOf(current, 'step').n);
      if (!verdict) {
        const limit = gates.limits({ events: all, issue, kind: 'review', repo });
        if (limit.result === 'pass')
          return again(current, 'review', `review round ${round}: ${checked.reason}, one retry`);
        emit(
          'step.finished',
          { task, step: { ...fieldsOf(current, 'step'), text: `review round ${round}: failed` } },
          'warning',
        );
        if (limit.result !== 'owner') return decide('limits', limit)!;
        return handOver(`review failed: ${checked.reason}`, 'limits');
      }
      text = `review round ${round}: ${verdict}`;
    }
    emit(
      'step.finished',
      { task, step: { ...fieldsOf(current, 'step'), name, text } },
      text.endsWith('changes') ? 'warning' : 'success',
    );
  }

  const base = String(fieldsOf(started, 'deliver').base);
  const at = await (input.trackerAt ?? (() => tracker))(base);
  if (role === 'implementer') {
    // the implementer finished: its pull request goes to review, a fix round to the next one
    const pull = at.pullOf(item());
    if (!pull) return end('session ended without a pull request');
    pr = pull.url;
    const target = at.pullRequest(pull.id).base;
    if (target !== base) return end(`the pull request goes into ${target}, not into ${base}`);
    const stop = decide('stage', gates.stage(at, item(), 'review'));
    if (stop) return stop;
    const head = at.compareRefs(pull).head;
    const round = reviewRound(own(), issue);
    // one verdict file per round: a verdict of an earlier round is never read as this one
    const verdictFile = path.join(runDir, `${issue}.review-${round}.json`);
    rmSync(verdictFile, { force: true });
    const model = resolveModel({
      role: 'review',
      harness: config.deliver?.harness,
      layers: input.layers ?? [],
    }).model;
    emit('step.started', {
      task,
      step: { name: `review-${round}`, n: round, text: `review round ${round} of ${head}` },
      deliver: {
        role: 'reviewer',
        base,
        branch: pull.branch,
        pr: pull.url,
        number: pull.id,
        head,
        model,
        verdictFile,
      },
    });
    return startAction(issue, all.at(-1)!);
  }

  // the review finished: verdict, guard, merge, each a gate; only the commit of this round is merged
  const head = String(cd.head);
  const verdictFile = String(cd.verdictFile);
  const pull: Pull = { id: Number(cd.number), title: '', url: String(cd.pr), branch: '' };
  const merging = ofType('step.started').find(
    (event) => stepName(event) === 'merge' && after(event),
  );
  if (!merging) {
    const verdict = gates.verifyVerdict({
      content: readIfThere(verdictFile),
      reviewedHead: head,
      prHead: at.compareRefs(pull).head,
    });
    const { findings, unmet } = verdict.evidence;
    if (verdict.result === 'fail' && Array.isArray(findings)) {
      // the review asks for changes: a fix round while the limits gate allows one
      const limit = gates.limits({ events: all, issue, kind: 'fix', repo });
      if (limit.result === 'owner') {
        const line = findingsLine({
          verdict: 'changes',
          findings,
          unmet: Array.isArray(unmet) ? unmet : [],
        } as Verdict);
        // the findings are text of an agent: it never ends the reason, whose ending decides about a hand-over
        return handOver(`${limit.reason} (${line})`, 'limits');
      }
      const stop = decide('limits', limit) ?? decide('stage', gates.stage(at, item(), 'changes'));
      if (stop) return stop;
      const n = Number(limit.evidence.count) + 1;
      const d = fieldsOf(started, 'deliver');
      emit('step.started', {
        task,
        step: { name: `fix-${n}`, n, text: `fix round ${n} of ${Number(limit.evidence.limit)}` },
        deliver: {
          role: 'implementer',
          base,
          branch: d.branch,
          model: d.model,
          resultFile,
          reviewFile: verdictFile,
          counted: 'fix',
          ...(backmerge && { backmerge }),
        },
      });
      return startAction(issue, all.at(-1)!);
    }
    const stop =
      decide('verify-verdict', verdict) ??
      decide('stage', gates.stage(at, item(), 'approved')) ??
      decide(
        'guard',
        await gates.guard([
          String(pull.id),
          '--head',
          head,
          '--tracker',
          at.name,
          '--result-file',
          resultFile,
        ]),
      );
    if (stop) return stop;
    emit('step.started', {
      task,
      step: { name: 'merge', text: `merge of ${head}` },
      deliver: { head },
    });
  }
  // a merge that began runs the merge gate only: it checks the verdict and the guard itself
  const mergeStart = merging ?? all.at(-1)!;
  const inMerge = (now() - (Date.parse(String(mergeStart.ts)) || now())) / 1000;
  const merge = await gates.mergeApproved([
    String(pull.id),
    head,
    '--verdict',
    verdictFile,
    '--result-file',
    resultFile,
    '--tracker',
    at.name,
    ...(inMerge > UNREPORTED_OK_S ? ['--unreported-ok'] : []),
  ]);
  if (merge.result !== 'pass' && merge.result !== 'retry') {
    // merged meanwhile (by an attempt before this call, or by a person): delivered, whatever the word says now
    let state: string | undefined;
    try {
      state = at.gate(pull).state;
    } catch {
      // unknown is not merged
    }
    if (state === 'merged') {
      emit('step.finished', { task, step: { name: 'merge', text: 'already merged' } }, 'success');
      return finishMerged();
    }
  }
  const notMerged = decide('merge-approved', merge);
  if (notMerged) return notMerged;
  emit('step.finished', { task, step: { name: 'merge', text: merge.reason } }, 'success');
  return finishMerged();
}
