// The leaf flow of deliver-lead (ADR 0012): one PBI or Bug is implemented, reviewed, guarded and merged. `leafStep` is
// stateless: every call reads the run's agent-events (and the tracker), runs the gate scripts of the sibling skill
// `deliver` and returns the one host verb (references/host-verbs.md of `deliver`) the lead executes next, or `end`.
// The lead passes the outcome of that verb back as `result`. Every event is written before the verb it records is
// returned, so a lead that ends after any action resumes from the events without repeating a step.
//
// Events of the task `issue-<n>` (profile deliver@2), in this order on the pass path:
//   task.started; step.started `implement` (`deliver`: role, base, branch, model, result file, merged-meanwhile file);
//   deliver.worker (the handle of the started worker); step.finished `implement`; step.started `review-<n>` (`n`,
//   `deliver`: the reviewed commit `head`, the pull request, the verdict file of that round); deliver.worker;
//   step.finished `review-<n>` (`review round <n>: <verdict>`, as the loop writes it); step.started and
//   step.finished `merge`; task.finished `succeeded`; deliver.merged. A gate word other than `pass` ends the task
//   (task.finished `skipped`, `deliver.gate` and `deliver.result` name the gate).
import { execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { runOrigin } from '../../deliver/scripts/event-dir.mts';
import { guardCli, riskOf } from '../../deliver/scripts/gates/guard.mts';
import { readRunEvents, reviewRound, type RunEvent } from '../../deliver/scripts/gates/limits.mts';
import { mergeApprovedCli } from '../../deliver/scripts/gates/merge-approved.mts';
import { issueType, mergeBaseGate } from '../../deliver/scripts/gates/merge-base.mts';
import {
  type MergedMeanwhile,
  mergedMeanwhile,
} from '../../deliver/scripts/gates/merged-meanwhile.mts';
import { type GateResult, UsageError } from '../../deliver/scripts/gates/result.mts';
import { setStageGate } from '../../deliver/scripts/gates/stage.mts';
import { verifyVerdict } from '../../deliver/scripts/gates/verify-verdict.mts';
import { type ConfigLayer, resolveModel } from '../../deliver/scripts/resolve-model.mts';
import { parseVerdict } from '../../deliver/scripts/review.mts';
import { issueTier } from '../../deliver/scripts/session-models.mts';
import type { Stage } from '../../deliver/scripts/stage.mts';
import type { Item, Pull, Tracker } from '../../deliver/scripts/tracker.mts';

/** How long one wait for a worker lasts, in seconds: the session timeout of the loop (90 minutes). */
export const STAGE_TIMEOUT_S = 90 * 60;

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
  | { do: 'wait-any'; handles: string[]; timeout: number }
  | { do: 'read-result'; handle: string }
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

/** The outcome of the previous verb: `start-worker` gives `handle` (or `error`), `wait-any` `handle` and `state`, `read-result` `handle` and `report`. */
export type StepResult = {
  handle?: string;
  state?: 'done' | 'blocked' | 'error' | 'gone' | 'timeout';
  /** The worker's report: a path or the text. */
  report?: string;
  /** A blocked worker's question, or why a start was refused. */
  question?: string;
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
};

const RUN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const STEP_NAME = /^(implement|review-\d+)$/;

type Body = Record<string, unknown>;
const fieldsOf = (event: RunEvent | undefined, key: string): Body =>
  (event?.[key] && typeof event[key] === 'object' ? event[key] : {}) as Body;
const stepName = (event: RunEvent): string => String(fieldsOf(event, 'step').name ?? '');
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

/** The writer of the run file; it continues `seq` after the events already there. A failed write throws: events are the state. */
function eventWriter(dir: string, run: string, known: RunEvent[]) {
  let seq = known.reduce((max, event) => Math.max(max, Number(event.seq) || 0), 0);
  mkdirSync(dir, { recursive: true });
  return (type: string, body: Body = {}, tone = 'neutral') => {
    seq += 1;
    const event = { v: 1, seq, ts: new Date().toISOString(), run, type, tone, ...body };
    appendFileSync(path.join(dir, `${run}.jsonl`), `${JSON.stringify(event)}\n`);
    known.push(event);
  };
}

/** The start of a worker, rebuilt from its `step.started`: a repeated call returns the same action. */
function startAction(issue: number, started: RunEvent): Action {
  const name = stepName(started);
  const d = fieldsOf(started, 'deliver');
  const base = String(d.base);
  if (name === 'implement') {
    const file = String(d.resultFile);
    const meanwhile = str(d.mergedMeanwhile);
    const command = `/deliver ${issue} --base ${base}${meanwhile ? ` --merged-meanwhile-file ${meanwhile}` : ''}`;
    return {
      do: 'start-worker',
      role: 'implementer',
      name: `issue-${issue}-implement`,
      brief: [
        `Deliver issue #${issue} in this worktree: run \`${command}\`.`,
        `Open its pull request into ${base} from the branch ${String(d.branch)}; never merge it.`,
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
    name: `issue-${issue}-${name}`,
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
 * One step of the leaf flow: the next action for `issue` in `run`. Throws for wrong input (the CLI reports `usage`);
 * a gate word other than `pass` ends the task with its reason.
 */
export async function leafStep(input: LeafInput): Promise<Action> {
  const { tracker, issue, run, result } = input;
  if (!Number.isInteger(issue) || issue < 1) throw new UsageError(`no issue number: ${issue}`);
  if (!RUN.test(run)) throw new UsageError(`no run id: ${run}`);
  if (!input.events)
    throw new UsageError('no events directory: set AGENT_EVENTS_DIR (the events are the state)');
  const gates = { ...GATES, ...input.gates };
  const cwd = input.cwd ?? process.cwd();
  const runDir = input.runDir ?? runFolder(cwd, run);
  const config = input.config ?? {};
  const repo = tracker.repo;
  const task = `issue-${issue}`;

  const all = readRunEvents(input.events, run) ?? [];
  const emit = eventWriter(input.events, run, all);
  const own = () => all.filter((event) => event.task === task);
  const ofType = (type: string) => own().filter((event) => event.type === type);
  const workers = () =>
    all.filter(
      (event) => event.type === 'deliver.worker' && fieldsOf(event, 'deliver').issue === issue,
    );

  const finished = ofType('task.finished').at(-1);
  if (finished) return { do: 'end', report: reportOf(issue, finished) };

  const resultFile = path.join(runDir, `${issue}.result.json`);
  const item = (title = ''): Item => ({ id: issue, title, url: '', labels: [], body: '' });
  let pr: string | undefined;
  let backmerge: string | undefined;
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
  /** `undefined` on `pass`, else the end with the gate's reason. */
  const passes = (name: string, gate: GateResult): Action | undefined =>
    gate.result === 'pass'
      ? undefined
      : end(`${name}: ${gate.reason}`, { gate: name, word: gate.result });

  const steps = own().filter(
    (event) => event.type === 'step.started' && STEP_NAME.test(stepName(event)),
  );
  let current = steps.at(-1);

  if (!current) {
    // the start: stage, merge base, what was merged meanwhile, then the implementer
    const found = tracker.issue({ repo, number: issue });
    if (!found) throw new UsageError(`#${issue} not found in ${repo}`);
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
    const staged = passes('stage', gates.stage(tracker, item(found.title), 'implementing'));
    if (staged) return staged;
    // the issue was read once: the gate applies its rule to it
    const reader = { repo, issue: () => found } as unknown as Tracker;
    const base = gates.mergeBase(reader, issue, config);
    return passes('merge-base', base) ?? startImplementer(found, level ?? 'pbi', base);
  }

  function startImplementer(
    found: { number: number; title: string; body: string },
    level: string,
    mergeBase: GateResult,
  ): Action {
    const base = String(mergeBase.evidence.base);
    backmerge = str(mergeBase.evidence.backmerge);
    const meanwhile = gates.mergedMeanwhile({ workspace: cwd, base, issue, runDir });
    const stop = passes('merged-meanwhile', meanwhile);
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

  const implement = steps.find((event) => stepName(event) === 'implement')!;
  backmerge = str(fieldsOf(implement, 'deliver').backmerge);
  pr = str(fieldsOf(steps.filter((e) => stepName(e) !== 'implement').at(-1), 'deliver').pr);
  const isFinished = (step: RunEvent) =>
    ofType('step.finished').some((event) => stepName(event) === stepName(step));

  if (!isFinished(current)) {
    const name = stepName(current);
    const worker = workers().find((event) => fieldsOf(event, 'deliver').step === name);
    const role = String(fieldsOf(current, 'deliver').role) as Role;
    if (!worker) {
      const known = new Set(workers().map((event) => fieldsOf(event, 'deliver').handle));
      if (result?.handle && !known.has(result.handle)) {
        emit('deliver.worker', {
          deliver: { repo, issue, role, step: name, handle: result.handle },
        });
        return { do: 'wait-any', handles: [result.handle], timeout: STAGE_TIMEOUT_S };
      }
      if (!result?.handle && (result?.error || result?.state))
        return end(`the ${role} did not start: ${result.error ?? result.state}`);
      return startAction(issue, current);
    }
    const handle = String(fieldsOf(worker, 'deliver').handle);
    const answer = result?.handle === handle ? result : undefined;
    if (answer?.report === undefined) {
      if (answer?.state === 'done') return { do: 'read-result', handle };
      if (answer?.state === 'timeout') return end(`session timeout: the ${role} did not finish`);
      if (answer?.state === 'blocked')
        return end(`the ${role} is blocked: ${answer.question ?? 'no question given'}`);
      if (answer?.state) return end(`the ${role} ended without a result (${answer.state})`);
      return { do: 'wait-any', handles: [handle], timeout: STAGE_TIMEOUT_S };
    }
    if (!answer.report.trim()) return end(`the ${role} left no report: the work is not done`);
    // the report is a claim: what counts is the pull request and the verdict file the gates read
    const text =
      role === 'implementer'
        ? 'implementer finished'
        : `review round ${String(fieldsOf(current, 'step').n)}: ${
            parseVerdict(readIfThere(String(fieldsOf(current, 'deliver').verdictFile)) ?? '')
              ?.verdict ?? 'failed'
          }`;
    emit(
      'step.finished',
      { task, step: { name, ...fieldsOf(current, 'step'), text } },
      text.endsWith('changes') || text.endsWith('failed') ? 'warning' : 'success',
    );
  }

  const at = await (input.trackerAt ?? (() => tracker))(
    String(fieldsOf(implement, 'deliver').base),
  );
  current = steps.at(-1)!;
  if (stepName(current) === 'implement') {
    // the implementer finished: its pull request goes to review
    const base = String(fieldsOf(implement, 'deliver').base);
    const pull = at.pullOf(item());
    if (!pull) return end('session ended without a pull request');
    pr = pull.url;
    const target = at.pullRequest(pull.id).base;
    if (target !== base) return end(`the pull request goes into ${target}, not into ${base}`);
    const stop = passes('stage', gates.stage(at, item(), 'review'));
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

  // the review finished: verdict, guard, merge, each a gate
  const d = fieldsOf(current, 'deliver');
  const head = String(d.head);
  const verdictFile = String(d.verdictFile);
  const pull: Pull = {
    id: Number(d.number),
    title: '',
    url: String(d.pr),
    branch: String(d.branch),
  };
  const verdict = gates.verifyVerdict({
    content: readIfThere(verdictFile),
    reviewedHead: head,
    prHead: at.compareRefs(pull).head,
  });
  const notApproved = passes('verify-verdict', verdict);
  if (notApproved) return notApproved;
  const approved = passes('stage', gates.stage(at, item(), 'approved'));
  if (approved) return approved;
  const id = String(pull.id);
  const name = at.name;
  const guarded = passes(
    'guard',
    await gates.guard([id, '--head', head, '--tracker', name, '--result-file', resultFile]),
  );
  if (guarded) return guarded;
  if (!ofType('step.started').some((event) => stepName(event) === 'merge'))
    emit('step.started', { task, step: { name: 'merge', text: `merge of ${head}` } });
  const merge = await gates.mergeApproved([
    id,
    head,
    '--verdict',
    verdictFile,
    '--result-file',
    resultFile,
    '--tracker',
    name,
  ]);
  const notMerged = passes('merge-approved', merge);
  if (notMerged) return notMerged;
  emit('step.finished', { task, step: { name: 'merge', text: merge.reason } }, 'success');
  // merged: no `agent:*` label is left (ADR 0009); a failed label call does not undo the merge
  const cleared = gates.stage(at, item(), undefined);
  const risk = riskOf(resultFile);
  emit(
    'deliver.merged',
    { deliver: { repo, issue, pr: pull.url, ...(risk && { risk }) } },
    'success',
  );
  return end(
    cleared.result === 'pass' ? 'merged' : `merged; stage not cleared: ${cleared.reason}`,
    {
      merged: true,
    },
  );
}
