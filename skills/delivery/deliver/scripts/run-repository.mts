// The work of one repository in a deliver run: a fresh agent session per issue, a review session for its pull
// request, merge. Up to `parallel` issues are worked at once, merges one at a time; the state is read from the tracker
// whenever an issue ends. The run only remembers what it set aside. `deliver-loop.mts` parses the arguments and calls `runRepository` once.
// Tracker: tracker.mts. Progress events: events.mts. Review settings and verdict: review.mts. Issue stage: stage.mts, gates/stage.mts.
// Model of each session: session-models.mts. Comments on the issue: handover.mts. Stop request: stop-signal.mts.
// Parallel sessions and the merge lock: parallel.mts.
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import type { tokenSource as makeSource } from './app-token.mts';
import type { Origin } from './event-dir.mts';
import { type Emit, reasonCode } from './events.mts';
import { mergedMeanwhile } from './gates/merged-meanwhile.mts';
import { verifyVerdict } from './gates/verify-verdict.mts';
import { type Note, handoverNote, reviewNote } from './handover.mts';
import { type BlockedReason, type Report, finishReport } from './program-status.mts';
import { HANDS_OFF, guardCheck, readChangedFiles, riskOf } from './gates/guard.mts';
import { cargoTomlKeys } from './cargo-toml.mts';
import { directoryPackagesPropsKeys } from './directory-packages-props.mts';
import { releaseGate, retroMarker } from './gates/release-gate.mts';
import { setStageGate } from './gates/stage.mts';
import { goModKeys } from './go-mod.mts';
import { pyprojectTomlKeys } from './pyproject-toml.mts';
import { pnpmWorkspaceKeys } from './pnpm-workspace.mts';
import { inPickOrder } from './gates/next-issue.mts';
import type { Harness } from './harness.mts';
import { MergeLocks, Slots } from './parallel.mts';
import { killTree, launch, promptPath } from './process.mts';
import { progressLine } from './progress-bar.mts';
import {
  RISK_LEVELS,
  type ReviewMark,
  type ReviewSettings,
  type Verdict,
  findingsLine,
  featureText,
  type retroSettings,
} from './review.mts';
import type { Tier } from './resolve-model.mts';
import type { Pick, sessionModels } from './session-models.mts';
import { type StageEvent, stageAfter, stageOf } from './stage.mts';
import type { StopSignal } from './stop-signal.mts';
import type { BaseState, Gate, Item, Pull, Tracker } from './tracker.mts';
import {
  type Triage,
  type TriageCase,
  type TriageRun,
  answerComment,
  ANSWER_MARKER,
  caseKey,
  caseSlug,
  parseTriage,
  preparedText,
} from './triage.mts';

type Session = {
  exit: number | null;
  turns: number;
  costUsd: number;
  peakContext: number;
  /** The loop killed the session at the session timeout. */
  timedOut?: boolean;
  /** The reason of a final `result: blocked <reason>` line of the session. */
  blocked?: string;
  /** Set for a review session. */
  role?: 'review';
  model: string;
  tier: Tier;
};
type Retro = { url?: string; failed?: string };
export type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'dim' | 'bold';

export const run = (cmd: string, args: string[], cwd?: string): string =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
export const attempt = (cmd: string, args: string[], cwd?: string): string | undefined => {
  try {
    return run(cmd, args, cwd);
  } catch {
    return undefined;
  }
};
// Tests only: the length of one second of waiting, so a test does not wait for real.
const TICK_MS = Number(process.env.DELIVER_TICK_MS ?? 1000);
const sleep = (seconds: number) => new Promise((done) => setTimeout(done, seconds * TICK_MS));
// Tests only: the session timeout in milliseconds instead of --session-minutes.
const SESSION_MS_OVERRIDE = Number(process.env.DELIVER_SESSION_MS) || undefined;
/** The message of a failed command: its stderr, else the error itself, first line only. */
export const firstLine = (error: unknown): string =>
  String((error as { stderr?: string }).stderr || (error as Error).message || error)
    .trim()
    .split('\n')[0];

// Output: the terminal gets color when it is a terminal, the log file (tail -f) unless NO_COLOR is set.
const CODES: Record<Tone, string> = {
  ok: '32',
  bad: '31',
  warn: '33',
  info: '36',
  dim: '2',
  bold: '1',
};
const paint = (line: string, tone: Tone | undefined, on: boolean) =>
  on && tone ? `\x1b[${CODES[tone]}m${line}\x1b[0m` : line;
export type Output = {
  say: (line: string, tone?: Tone) => void;
  /** `say` with the time of day in front. */
  log: (line: string, tone?: Tone) => void;
  /** From now on every line goes to this file too. */
  toFile: (file: string) => void;
};
export function createOutput(): Output {
  let logFile = '';
  const say = (line: string, tone?: Tone) => {
    console.log(paint(line, tone, Boolean(process.stdout.isTTY) && !process.env.NO_COLOR));
    if (logFile) appendFileSync(logFile, `${paint(line, tone, !process.env.NO_COLOR)}\n`);
  };
  const log = (line: string, tone?: Tone) =>
    say(`${new Date().toTimeString().slice(0, 8)} ${line}`, tone);
  return {
    say,
    log,
    toFile: (file) => {
      logFile = file;
    },
  };
}

// the retro session reads and writes one comment (through its script): it never pushes or changes issues and pull requests
const RETRO_DENY = [
  'git push',
  'gh issue create',
  'gh issue edit',
  'gh issue close',
  'gh pr create',
  'gh pr edit',
  'gh pr merge',
  'gh pr close',
];
// A fix round per `changes` verdict, at most this many per issue and run; the next `changes` sets the issue aside.
const FIX_ROUNDS = 2;

const MORE_PULLS = 'more than one open pull request';
/** Two open pull requests of one item: a person closes the stale one, the loop merges neither. */
function morePulls(pull: Pull | undefined): string | undefined {
  if (!pull?.others?.length) return undefined;
  return `${MORE_PULLS} (${[pull.url, ...pull.others].join(', ')})${HANDS_OFF}`;
}
/** The reason of a `result: blocked` session is kept next to the reason of the loop. */
function withBlocked(reason: string, session: Session): string {
  if (!session.blocked) return reason;
  const note = `session: blocked ${session.blocked}`;
  return reason.endsWith(HANDS_OFF)
    ? `${reason.slice(0, -HANDS_OFF.length)} (${note})${HANDS_OFF}`
    : `${reason} (${note})`;
}

/** One line of the stream-json of Claude Code, as far as the loop reads it. */
type StreamRecord = {
  type?: string;
  num_turns?: number;
  total_cost_usd?: number;
  is_error?: boolean;
  result?: string;
  parent_tool_use_id?: string | null;
  message?: {
    usage?: Record<string, number | undefined>;
    content?: { type: string; text?: string; name?: string; input?: Record<string, unknown> }[];
  };
};

const noteBlocked = (text: string, session: Session): void => {
  const blocked = /^result:\s*blocked\s+(.+)$/.exec(text.trim());
  if (blocked) session.blocked = blocked[1]?.slice(0, 300);
};

const RESULT_GRACE_MS = Number(process.env.DELIVER_RESULT_GRACE_MS ?? 30_000);

/** True for the final `result` record of a session whose text ends with a `result:` line. */
function finishedResult(line: string): boolean {
  if (!line.startsWith('{')) return false;
  try {
    const event: StreamRecord = JSON.parse(line);
    if (event?.type !== 'result' || event.is_error || typeof event.result !== 'string')
      return false;
    const last = event.result.trimEnd().split('\n').pop() ?? '';
    return /^result: (pr \S+|needs-decision|reviewed (approve|changes)|retro \S+|blocked\b.*)$/.test(
      last.trim(),
    );
  } catch {
    return false;
  }
}

/**
 * The next step of an issue; `merge` names the approved commit, `reviewFile` holds the findings the implementer
 * fixes.
 */
type Step =
  | { step: 'implement'; reviewFile?: string }
  | { step: 'review' }
  | { step: 'merge'; head: string };

/** What one session is for: the implementer of the issue, the review of its pull request, or the retro of the run. */
type Task = {
  /** The slash command; the loop appends the issue file. */
  prompt: string;
  harness: Harness;
  model: string;
  /** The tier of the role for this session, also when a flag or setting names the model. */
  tier: Tier;
  effort?: string;
  /** Commands the session may not run (`HarnessInput.deny`). */
  deny?: string[];
  /** The file the session writes its answer to, and the variable that names it. */
  output: {
    name:
      | 'DELIVER_RESULT_FILE'
      | 'DELIVER_REVIEW_FILE'
      | 'DELIVER_RETRO_FILE'
      | 'DELIVER_TRIAGE_FILE';
    file: string;
  };
  /** The name of the session in the log; default the issue, else `retro`. */
  label?: string;
  /** A failed session that left its work behind is no harness failure. */
  delivered(): boolean;
  role?: 'review';
};

const CLOSED = 'pull request closed';

// Harness failures (exit ≠ 0, no pull request, no timeout kill): wait 5, 15, 60 minutes, the third in a row ends the run.
const HARNESS_WAITS_MINUTES = [5, 15, 60];
const HARNESS_FAILED = 'harness failed';

// A review without a valid verdict gets one more session, then the issue is set aside.
const REVIEW_ATTEMPTS = 2;

type Review = { round: number; verdict: Verdict['verdict'] | 'failed' };
type Reviewed = { verdict: Verdict; file: string; head: string } | { reason: string };

/**
 * Tracker calls block the event loop: a stop request that came in meanwhile is only read in the poll phase.
 * A timer runs before the poll phase, and from a poll callback the check phase follows without a new poll:
 * two setImmediate turns always include one full poll.
 */
async function seeStop(): Promise<void> {
  await new Promise((turn) => setImmediate(turn));
  await new Promise((turn) => setImmediate(turn));
}

// The triage of an attention case judges and changes nothing: the loop applies its result.
const TRIAGE_DENY = [
  ...RETRO_DENY,
  'gh issue comment',
  'gh pr comment',
  'gh pr review',
  'gh label',
  'gh run rerun',
  'gh run cancel',
  'gh workflow run',
  'git commit',
];
// a hand-over of these reasons is the owner's (deliver-triage, Limits): the loop applies no other action than the
// prepared decision or a drafted follow-up, whatever the result says
const OWNER_ONLY = ['deliver.protected-paths', 'deliver.merge-risk'];

/** What the run of one repository is given; the CLI (deliver-loop.mts) builds it from the flags and the config. */
export type RepositoryOptions = {
  /** Exactly one is set. */
  milestone?: string;
  feature?: string;
  issues?: string;
  /** The base branch of the pull requests. */
  base: string;
  dryRun: boolean;
  allowNoRequiredChecks: boolean;
  /** `--model`: the model of every implementer session. */
  model?: string;
  /** At most this many issues, 0: no limit. */
  max: number;
  /** At most this many role sessions at once in this repository (`deliver.parallel`, `--parallel`); 1 works one issue after the other. */
  parallel: number;
  sessionMinutes: number;
  mergeMinutes: number;
  handoverMinutes: number;
  mergeRisk: string;
  harnessName: string;
  harness: Harness;
  review: ReviewSettings;
  models: ReturnType<typeof sessionModels>;
  retro: ReturnType<typeof retroSettings>;
  protectedPaths: string[];
  /** Tests only: the harness command from DELIVER_HARNESS (the prompt is appended). */
  harnessOverride?: string[];
  /** An Objective run: its attention cases go to `deliver-triage`, each once across the units of the run. */
  triage?: TriageRun;
};
/** The events of the run: nothing is written before `open` (a dry run writes none). */
export type EventSink = {
  open(): { run: string; dir: string | undefined; origin: Origin };
  emit: Emit;
};
export type RepositoryContext = {
  /** The checkout of the repository. */
  root: string;
  options: RepositoryOptions;
  tracker: Tracker;
  /** The token of the sessions: minted (GitHub App) or fixed; `name` names the source, none: the login of the user. */
  token: { source?: ReturnType<typeof makeSource>; fixed?: string; name?: string };
  runId: string;
  runDir: string;
  events: EventSink;
  /** OSC 7501 to the controlling terminal (program-status.mts). */
  status: (report: Report) => void;
  signal: StopSignal;
  out: Output;
  /** One merge at a time per repository and base branch; repositories of one run share them. Default: of this run. */
  mergeLocks?: MergeLocks;
  /** The role sessions of a run over several repositories (an Objective, `maxSessions`): this one also stays within `parallel`. */
  slots?: Slots;
  /** The run folders whose result files hold earlier risk levels. Default: those beside `runDir`. */
  earlierRunDirs?: () => string[];
};
export type RepositoryResult = {
  /** 0 done, 2 blocked, 3 waiting for a handed-over pull request (or refused), 5 harness failed, 130 stopped; 1 error, 64 usage. */
  exitCode: number;
  status?: 'done' | 'blocked' | 'failed' | 'waiting-for-handed-over';
  merged: string[];
  aside: Map<number, string>;
  waiting: string[];
  needsYou: string[];
  handedOver: Map<number, string>;
  /** What the triage of the run applied: an answer, an item dropped from the run, a CI job re-run. */
  triaged: string[];
};

/** The title of the run in OSC 7501. */
export const titleOf = (selection: { milestone?: string; feature?: string; issues?: string }) =>
  selection.milestone ??
  (selection.feature ? `feature #${selection.feature}` : `issues ${selection.issues}`);

export async function runRepository(context: RepositoryContext): Promise<RepositoryResult> {
  const { root, tracker, runId, runDir, events, signal, out } = context;
  const { say, log } = out;
  const {
    base: BASE,
    milestone,
    dryRun,
    allowNoRequiredChecks,
    model: MODEL_FLAG,
    max: MAX,
    parallel: PARALLEL,
    sessionMinutes: SESSION_MINUTES,
    mergeMinutes: MERGE_MINUTES,
    handoverMinutes: HANDOVER_MINUTES,
    mergeRisk: MERGE_RISK,
    harnessName,
    harness,
    review: REVIEW,
    models: MODELS,
    retro: RETRO,
    protectedPaths: PROTECTED,
    harnessOverride: HARNESS_OVERRIDE,
  } = context.options;
  const { source: tokenSource, fixed: FIXED_TOKEN, name: TOKEN_SOURCE } = context.token;
  // what a run starts with: an issue of tier standard; the tier of each issue decides its own sessions
  const STANDARD = { implement: MODELS.implement(''), review: MODELS.review('') };
  const MODEL_LINE = `implement ${MODEL_FLAG ?? `by the issue's tier (standard ${STANDARD.implement.model})`}, review ${STANDARD.review.model}, retro ${RETRO.enabled ? RETRO.model : 'off'}`;
  /** A run that ends before it started: the message goes to stderr. */
  const ended = (exitCode: number, message?: string): RepositoryResult => {
    if (message) console.error(message);
    return {
      exitCode,
      merged: [],
      aside: new Map(),
      waiting: [],
      needsYou: [],
      handedOver: new Map(),
      triaged: [],
    };
  };

  /** Why the loop does not merge the pull request as it is now, else nothing. A person decides then, no repair session. */
  async function guard(pull: Pull, head?: string): Promise<string | undefined> {
    // a read that fails once (server load, rate limit) is asked again, as the gate is
    const files = await readChangedFiles(() => tracker.changedFiles(pull), {
      pause: async () => {
        for (let second = 0; second < 5 && !signal.stopped; second++) await sleep(1);
      },
      stopped: () => signal.stopped,
    });
    // unknown is not safe: a person looks
    const check = guardCheck({
      files,
      compare: {
        refs: () => tracker.compareRefs(pull, head),
        fileAt: (sha, file) => tracker.fileAt(sha, file),
      },
      protectedList: PROTECTED,
    });
    return check.result === 'pass' ? undefined : check.reason;
  }

  let emit: Emit = () => {};
  // every role session (implementer, review, repair, retro) takes a slot; the events report the running ones
  let reportedSessions = 0;
  const onSessions = (running: number) => {
    if (running === reportedSessions) return;
    reportedSessions = running;
    emit('deliver.sessions', { deliver: { repo: tracker.repo, running, limit: slots.limit } });
  };
  // an Objective run shares its slots across the repositories: this one holds at most PARALLEL of them
  const slots = context.slots
    ? context.slots.within(PARALLEL, onSessions)
    : new Slots(PARALLEL, onSessions);
  const mergeLock = (context.mergeLocks ?? new MergeLocks()).of(tracker.repo, BASE);

  /** Prints the readable part of one stream record and keeps the numbers of the session. */
  function render(line: string, session: Session): void {
    let event: StreamRecord;
    try {
      event = JSON.parse(line);
    } catch {
      noteBlocked(line, session);
      say(`  ${line}`);
      return;
    }
    if (!event || typeof event !== 'object') return;
    if (event.type === 'result') {
      session.turns = event.num_turns ?? 0;
      session.costUsd = event.total_cost_usd ?? 0;
    }
    if (event.type !== 'assistant') return;
    const main = !event.parent_tool_use_id;
    const usage = event.message?.usage;
    if (main && usage) {
      const context =
        (usage.input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0);
      session.peakContext = Math.max(session.peakContext, context);
    }
    for (const block of event.message?.content ?? []) {
      if (block.type === 'text' && main) {
        for (const text of String(block.text).split('\n')) {
          if (!text.trim()) continue;
          noteBlocked(text, session);
          say(
            `  ${text.trim().slice(0, 160)}`,
            text.trim().startsWith('result:') ? 'info' : undefined,
          );
        }
      }
      if (block.type === 'tool_use') {
        const input = block.input ?? {};
        const what = String(input.description ?? input.file_path ?? input.command ?? '');
        say(`  ${main ? '' : '  '}· ${block.name} ${what.split('\n')[0].slice(0, 100)}`, 'dim');
      }
    }
  }

  /** Writes the stage of the issue after the event. A failing call is logged: the label never decides about the run. */
  function mark(item: Item, event: StageEvent): void {
    const { result, reason } = setStageGate(tracker, item, stageAfter(event));
    if (result !== 'pass') log(`#${item.id} stage label not written: ${reason}`, 'warn');
  }

  /** Comments on the issue, once per marker. A failing call is logged, as for the label. */
  function note(item: Item, { marker, body }: Note): void {
    try {
      tracker.commentOnce(item, marker, body);
    } catch (error) {
      log(`#${item.id} issue comment not written: ${firstLine(error)}`, 'warn');
    }
  }

  /** Tells the person on the issue why it is theirs now, once per reason and head of the pull request. */
  function tell(item: Item, pull: Pull | undefined, reason: string, planned: boolean): void {
    let head = 'none';
    if (pull) {
      try {
        head = tracker.compareRefs(pull).head;
      } catch {
        head = 'unknown';
      }
    }
    const urls = pull ? [pull.url, ...(pull.others ?? [])] : [];
    note(item, handoverNote({ reason, planned, head, urls, risk: risks.get(item.id) }));
  }

  /**
   * Where the label of an earlier run lets the loop go on with an open pull request. `approved` counts only with the
   * approving verdict the loop recorded for the current head, else the pull request is reviewed. The marks of the
   * earlier run also give back its risk level and, for `changes`, the findings of the last review.
   */
  function resumeAt(item: Item, pull: Pull): Step {
    const stage = stageOf(item.labels);
    let marks: ReviewMark[] | undefined;
    try {
      marks = tracker.recordedVerdicts(pull);
    } catch (error) {
      log(`#${item.id} review marks unreadable: ${firstLine(error)}`, 'warn');
    }
    for (const { risk } of marks ?? []) noteRisk(item.id, risk);
    // a run that ended before the verdict left the level only in its result file
    for (const level of earlierRisks(item)) noteRisk(item.id, level);
    // handed over for its risk: still approved, so it goes to the merge gate again and no session is paid for
    const heldForRisk = stage === 'handover' && riskHold(item.id) !== undefined;
    if (stage === 'approved' || heldForRisk) {
      if (marks) {
        try {
          const { head } = tracker.compareRefs(pull);
          const latest = [...marks].reverse().find((m) => m.head === head);
          if (latest?.verdict === 'approve') return { step: 'merge', head };
          if (!heldForRisk)
            log(
              `#${item.id} agent:approved without an approving review of ${head}: reviews it`,
              'warn',
            );
        } catch (error) {
          log(`#${item.id} review verdict unreadable: ${firstLine(error)}, reviews it`, 'warn');
        }
      }
      if (!heldForRisk) return { step: 'review' };
    }
    if (stage === 'review') return { step: 'review' };
    const last = marks?.at(-1);
    if (stage === 'changes' && last?.review) {
      const reviewFile = path.join(runDir, `${item.id}.review-recorded.json`);
      writeFileSync(reviewFile, `${JSON.stringify(last.review, null, 2)}\n`);
      return { step: 'implement', reviewFile };
    }
    if (stage === 'changes')
      log(`#${item.id} no recorded findings: the implementer starts without them`, 'warn');
    return { step: 'implement' };
  }

  const risks = new Map<number, string>();
  /** The implementer result the session writes (`risk.level`); the session never reports anything else to the loop. */
  const resultFile = (item: Item) => path.join(runDir, `${item.id}.result.json`);
  /** The levels the result files of earlier runs hold for the issue. */
  function earlierRisks(item: Item): (string | undefined)[] {
    const beside = path.dirname(runDir);
    const runs =
      context.earlierRunDirs?.() ?? readdirSync(beside).map((name) => path.join(beside, name));
    return runs.map((folder) => riskOf(path.join(folder, `${item.id}.result.json`)));
  }
  /** The highest level seen wins: a later fix or repair session never lowers the risk of the pull request. */
  function noteRisk(id: number, level: string | undefined): void {
    if (level && RISK_LEVELS.indexOf(level) > RISK_LEVELS.indexOf(risks.get(id) ?? ''))
      risks.set(id, level);
  }
  /** Why the loop does not merge the pull request of the issue for its risk; a missing level counts as medium. */
  function riskHold(id: number): string | undefined {
    const check = guardCheck({ risk: risks.get(id), mergeRisk: MERGE_RISK });
    return check.result === 'pass' ? undefined : check.reason;
  }

  // a note about the model of an issue is logged once per run
  const modelNotes = new Set<string>();
  function picked(item: Item, { model, tier, note }: Pick): { model: string; tier: Tier } {
    const line = note && `#${item.id} ${note}`;
    if (line && !modelNotes.has(line)) {
      modelNotes.add(line);
      log(line, 'warn');
    }
    return { model, tier };
  }

  /** The implementer session; `reviewFile` is the verdict whose findings it fixes. */
  const implementer = (item: Item, reviewFile?: string): Task => ({
    prompt: `/deliver ${item.id} --base ${BASE}${reviewFile ? ` --review-file ${promptPath(reviewFile)}` : ''}`,
    harness,
    ...picked(item, MODELS.implement(item.body)),
    output: { name: 'DELIVER_RESULT_FILE', file: resultFile(item) },
    // a pull request means the session did its work: the normal rules for a failed session apply
    delivered: () => Boolean(tracker.pullOf(item)),
  });

  /**
   * The argument that names what was merged into the base since the fork point of the worktree, empty when nothing
   * was (ADR 0012, Parallelism). A list that cannot be made is logged: the session starts without it.
   */
  function mergedSince(item: Item, workspace: string): string {
    try {
      const gate = mergedMeanwhile({ workspace, base: BASE, issue: item.id, runDir });
      const { file } = gate.evidence;
      if (gate.result !== 'pass') log(`#${item.id} merged-meanwhile: ${gate.reason}`, 'warn');
      else if (typeof file === 'string') return ` --merged-meanwhile-file ${promptPath(file)}`;
    } catch (error) {
      log(`#${item.id} merged-meanwhile: ${firstLine(error)}`, 'warn');
    }
    return '';
  }

  /** `item`: the issue of the session; undefined for a session of the whole run (the retro). */
  async function startSession(
    item: Item | undefined,
    cwd: string,
    file: string,
    task: Task,
  ): Promise<Session> {
    const label = task.label ?? (item ? `#${item.id}` : 'retro');
    let prompt = task.prompt;
    if (item) {
      // the session works from this text, not from what the tracker shows when it runs
      const issueFile = path.join(runDir, `${item.id}.issue.md`);
      writeFileSync(issueFile, `# ${item.title}\n\n${item.url}\n\n${item.body}\n`);
      prompt += ` --issue-file ${promptPath(issueFile)}`;
    }
    // waits for a free slot: at most PARALLEL sessions run at once, the slot is freed when the process ended
    const free = await slots.acquire();
    try {
      // stopped while it waited: no session starts
      if (signal.stopped)
        return {
          exit: null,
          turns: 0,
          costUsd: 0,
          peakContext: 0,
          model: task.model,
          tier: task.tier,
        };
      // an implementer session; read now, as the base may have moved while it waited for its slot
      if (item && task.output.name === 'DELIVER_RESULT_FILE') prompt += mergedSince(item, cwd);
      return await launchSession(label, prompt, cwd, file, task);
    } finally {
      free();
    }
  }

  /** One process of the harness, from its start to its end. */
  async function launchSession(
    label: string,
    prompt: string,
    cwd: string,
    file: string,
    task: Task,
  ): Promise<Session> {
    const { model, effort, deny } = task;
    const argv = HARNESS_OVERRIDE
      ? [...HARNESS_OVERRIDE, prompt]
      : task.harness.command({ prompt, model, effort, deny });
    // an app token is renewed when less than the session timeout is left; the merge keeps the login of the user
    const sessionToken = tokenSource ? await tokenSource.current() : undefined;
    if (sessionToken?.renewed) log('app token minted for this session', 'dim');
    const token = sessionToken?.token ?? FIXED_TOKEN;
    // a stop that came in during the mint: no process is started, nothing would end it
    if (signal.stopped)
      return { exit: null, turns: 0, costUsd: 0, peakContext: 0, model, tier: task.tier };
    const env: NodeJS.ProcessEnv = {
      // -p stops subagents 10 minutes after the last turn unless the ceiling is off
      CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0',
      ...process.env,
      DELIVER_RUN: runId,
      ...(token ? tracker.sessionEnv(token) : {}),
    };
    // the session gets the token, never the way to mint one
    for (const name of [
      'DELIVER_SESSION_TOKEN',
      'DELIVER_APP_ID',
      'DELIVER_APP_KEY_FILE',
      'DELIVER_APP_KEY_COMMAND',
      'DELIVER_APP_API_URL',
      // a session gets only the file it writes
      'DELIVER_RESULT_FILE',
      'DELIVER_REVIEW_FILE',
      'DELIVER_RETRO_FILE',
      'DELIVER_TRIAGE_FILE',
    ])
      delete env[name];
    env[task.output.name] = task.output.file;
    // the answer of an earlier session is not the answer of this one
    rmSync(task.output.file, { force: true });
    const session: Session = {
      exit: null,
      turns: 0,
      costUsd: 0,
      peakContext: 0,
      ...(task.role && { role: task.role }),
      model,
      tier: task.tier,
    };
    const out = createWriteStream(file);
    return new Promise((done) => {
      const child = launch(argv, {
        cwd,
        stdio: ['ignore', 'pipe', 'inherit'],
        env,
      });
      const timer = setTimeout(
        () => {
          session.timedOut = true;
          killTree(child);
        },
        SESSION_MS_OVERRIDE ?? SESSION_MINUTES * 60_000,
      );
      const stop = () => killTree(child);
      const unlist = signal.enlist(stop);
      // a session that scheduled a wakeup prints its final result and then stays alive until the wakeup fires:
      // once the final `result:` line is in and nothing follows for a moment, the loop ends the process itself
      let grace: ReturnType<typeof setTimeout> | undefined;
      let finished = false;
      createInterface({ input: child.stdout! }).on('line', (line) => {
        out.write(`${line}\n`);
        clearTimeout(grace);
        if (finishedResult(line)) {
          grace = setTimeout(() => {
            finished = true;
            log(`${label} session printed its result and stays alive: ended by the loop`, 'dim');
            killTree(child);
          }, RESULT_GRACE_MS);
        }
        if (task.harness.claudeStream) render(line, session);
        else {
          // no stream format: the plain lines of the harness, without color codes and empty lines
          const plain = line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trimEnd();
          if (plain) {
            noteBlocked(plain, session);
            say(`  ${plain}`);
          }
        }
      });
      child.on('error', (error) => log(`${label} session: ${error.message}`, 'bad'));
      child.on('close', (code) => {
        clearTimeout(timer);
        clearTimeout(grace);
        unlist();
        out.end();
        session.exit = finished ? 0 : code;
        done(session);
      });
    });
  }

  let harnessFailures = 0;
  let harnessDead: { count: number; exit: number | null } | undefined;
  // a session timeout gets one more session per PBI and run, the second sets the PBI aside
  const timeouts = new Map<number, number>();

  /** Starts sessions for the item until one ends normally. Returns a reason when the item is to be set aside. */
  async function runSession(
    item: Item,
    worktree: string,
    sessions: Session[],
    task: Task = implementer(item),
  ): Promise<{ session: Session; reason?: string }> {
    for (;;) {
      const session = await startSession(
        item,
        worktree,
        path.join(runDir, `${item.id}-${sessions.length + 1}.jsonl`),
        task,
      );
      sessions.push(session);
      if (signal.stopped) return { session };
      if (session.timedOut) {
        const count = (timeouts.get(item.id) ?? 0) + 1;
        timeouts.set(item.id, count);
        if (count >= 2) return { session, reason: 'session timeout' };
        log(`#${item.id} session timeout (${SESSION_MINUTES} min), one more session`, 'warn');
        continue;
      }
      if (session.exit === 0) {
        harnessFailures = 0;
        return { session };
      }
      if (task.delivered()) return { session };
      harnessFailures += 1;
      if (harnessFailures >= HARNESS_WAITS_MINUTES.length) {
        harnessDead = { count: harnessFailures, exit: session.exit };
        return { session, reason: HARNESS_FAILED };
      }
      const minutes = HARNESS_WAITS_MINUTES[harnessFailures - 1];
      log(
        `#${item.id} harness failed (exit ${session.exit}, ${harnessFailures} in a row): waits ${minutes} min, then a fresh session`,
        'warn',
      );
      for (let half = 0; half < minutes * 2 && !signal.stopped; half++) await sleep(30);
      if (signal.stopped) return { session };
    }
  }

  /**
   * One review round: a session of its own in a fresh worktree at the head of the pull request, which writes its
   * verdict to a file. `head` is the commit that was reviewed: the only one the loop may merge.
   */
  async function review(
    item: Item,
    pull: Pull,
    round: number,
    sessions: Session[],
  ): Promise<Reviewed> {
    const worktree = path.join(path.dirname(root), `${path.basename(root)}-wt-${item.id}-review`);
    const drop = () => attempt('git', ['worktree', 'remove', '--force', worktree], root);
    let problem = 'no valid verdict';
    for (let tries = 1; tries <= REVIEW_ATTEMPTS; tries++) {
      const file = path.join(runDir, `${item.id}.review-${round}-${tries}.json`);
      try {
        const { head } = tracker.compareRefs(pull);
        // a failed fetch shows in the checkout: the commit is then missing
        attempt('git', ['fetch', '--quiet', 'origin', pull.branch], root);
        drop();
        run('git', ['worktree', 'add', '--quiet', '--detach', worktree, head], root);
        // the parent Feature as context of the review; the session never reads it from the tracker
        let prompt = `/deliver-review ${item.id} --base ${BASE} --pr ${pull.url}`;
        const feature = tracker.parentFeature(item);
        if (feature) {
          const featureFile = path.join(runDir, `${item.id}.feature.md`);
          writeFileSync(featureFile, featureText(feature));
          prompt += ` --feature-file ${promptPath(featureFile)}`;
        }
        const ran = await runSession(item, worktree, sessions, {
          prompt,
          harness: REVIEW.harness,
          ...picked(item, MODELS.review(item.body)),
          effort: REVIEW.effort,
          output: { name: 'DELIVER_REVIEW_FILE', file },
          delivered: () => existsSync(file),
          role: 'review',
        });
        if (signal.stopped) return { reason: 'stopped' };
        if (ran.reason) return { reason: ran.reason };
        if (ran.session.exit !== 0) problem = `session failed (exit ${ran.session.exit})`;
        else {
          const content = existsSync(file) ? readFileSync(file, 'utf8') : undefined;
          // the session reviewed `head`; the merge gate refuses a later push
          const { verdict, reason } = verifyVerdict({ content, reviewedHead: head, prHead: head });
          if (verdict) return { verdict, file, head };
          problem = reason;
        }
      } catch (error) {
        problem = firstLine(error);
      } finally {
        drop();
      }
      if (signal.stopped) return { reason: 'stopped' };
      if (tries < REVIEW_ATTEMPTS) log(`#${item.id} review: ${problem}, one retry`, 'warn');
    }
    return { reason: `review failed: ${problem}` };
  }

  // a handed-over pull request with a conflict gets one repair session per run, never a merge by the loop
  const conflictTried = new Set<number>();
  /**
   * Returns nothing when the gate of the pull request is no conflict (or it was tried in this run), else one line:
   * `conflict repaired` or `conflict not repaired: <why>` after one session (`/deliver <nr>` merges the base in).
   */
  async function repairConflict(
    item: Item,
    pull: Pull,
    worktree: string,
    sessions: Session[],
  ): Promise<string | undefined> {
    if (conflictTried.has(item.id) || signal.stopped) return undefined;
    const read = (): Gate | undefined => {
      try {
        return tracker.gate(pull);
      } catch {
        // a failing read is no verdict: no session
        return undefined;
      }
    };
    if (read()?.state !== 'conflict') return undefined;
    conflictTried.add(item.id);
    log(`#${item.id} ${pull.url} has a conflict, one repair session`, 'warn');
    mark(item, 'session-started');
    const ran = await runSession(item, worktree, sessions);
    if (signal.stopped) return undefined;
    if (ran.reason) return `conflict not repaired: ${ran.reason}`;
    if (ran.session.exit !== 0)
      return `conflict not repaired: session failed (exit ${ran.session.exit})`;
    const after = read();
    if (after?.state === 'conflict') return `conflict not repaired: ${after.detail}`;
    return 'conflict repaired';
  }

  /**
   * The retro of the delivered milestone, one session in a worktree of its own: it posts its report as one comment
   * (on the Feature, else on `release`) and writes the URL to its output file. Never throws: a retro that fails is
   * reported and changes nothing else.
   */
  async function retro(milestone: string, release: Pull | undefined): Promise<Retro> {
    const worktree = path.join(path.dirname(root), `${path.basename(root)}-wt-retro`);
    const drop = () => attempt('git', ['worktree', 'remove', '--force', worktree], root);
    const file = path.join(runDir, 'retro.result.json');
    const name = /\s/.test(milestone) ? JSON.stringify(milestone) : milestone;
    try {
      run('git', ['fetch', '--quiet', 'origin', BASE], root);
      drop();
      run('git', ['worktree', 'add', '--quiet', '--detach', worktree, `origin/${BASE}`], root);
      log(`retro of ${milestone} (${REVIEW.harnessName}, ${RETRO.model})`, 'info');
      const session = await startSession(undefined, worktree, path.join(runDir, 'retro.jsonl'), {
        prompt: `/retro --milestone ${name} --post${release ? ` --release-pr ${release.url}` : ''}`,
        harness: REVIEW.harness,
        model: RETRO.model,
        tier: MODELS.retro.tier,
        effort: REVIEW.effort,
        deny: RETRO_DENY,
        output: { name: 'DELIVER_RETRO_FILE', file },
        delivered: () => existsSync(file),
      });
      if (signal.stopped) return {};
      if (session.timedOut) return { failed: 'session timeout' };
      if (session.exit !== 0) return { failed: `session failed (exit ${session.exit})` };
      const url = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8'))?.url : undefined;
      if (typeof url !== 'string' || !tracker.isRetroComment(url, retroMarker(milestone)))
        return { failed: 'no retro comment' };
      return { url };
    } catch (error) {
      return { failed: firstLine(error) };
    } finally {
      drop();
    }
  }

  /**
   * Waits for the gate and merges the reviewed commit. Returns nothing when merged, else the reason; `conflict` when
   * the gate says so (another merge into the base can cause it). `held`: why a pull request that passes the gate is
   * handed over instead. The gate is read and the merge made under the merge lock of the base branch: one merge at a
   * time, and the next one reads its gate after the base moved.
   */
  async function merge(
    pull: Pull,
    reviewed: string,
    held?: string,
  ): Promise<{ reason?: string; conflict?: true }> {
    const start = Date.now();
    let problem = '';
    while (!signal.stopped) {
      const done = await mergeLock.run(
        async (): Promise<{ reason?: string; conflict?: true } | undefined> => {
          let gate: Gate;
          try {
            gate = tracker.gate(pull);
          } catch (error) {
            // a tracker call that fails once (network, rate limit) is not a verdict on the pull request
            problem = `tracker error: ${firstLine(error)}`;
            gate = { state: 'pending', reported: false };
          }
          if (gate.state === 'merged') return {};
          if (gate.state === 'closed') return { reason: CLOSED };
          if (gate.state === 'conflict') return { reason: gate.detail, conflict: true };
          if (gate.state === 'red') return { reason: `red: ${gate.detail}` };
          // checks register a moment after the pull request opens: nothing reported is not green yet
          if (gate.state === 'ready' && (gate.reported || Date.now() - start > 90_000)) {
            await seeStop();
            if (signal.stopped) return undefined;
            // only the approved commit is merged: what was pushed after the review was seen by nobody
            if (gate.head !== reviewed) return { reason: `pushed after the review${HANDS_OFF}` };
            // the files of the commit that is merged, not of the one the session left: a later push is checked too.
            // The merge names gate.head, so a push after this read is refused by the tracker.
            const handsOff = await guard(pull, gate.head);
            // the read of the files blocks too: a stop request that came in during it must be seen before the merge,
            // and before a hand-over changes the label
            await seeStop();
            if (signal.stopped) return undefined;
            if (handsOff) return { reason: handsOff };
            if (held) return { reason: held };
            try {
              tracker.merge(pull, gate.head);
              return {};
            } catch (error) {
              problem = `merge refused: ${(error as Error).message}`;
            }
          }
          return undefined;
        },
      );
      if (done) return done;
      if (signal.stopped) break;
      if (Date.now() - start > MERGE_MINUTES * 60_000)
        return { reason: problem || 'checks did not finish' };
      for (let second = 0; second < 30 && !signal.stopped; second++) await sleep(1);
    }
    return { reason: 'stopped' };
  }

  function cleanup(item: Item, pull: Pull): void {
    const worktree = path.join(path.dirname(root), `${path.basename(root)}-wt-${item.id}`);
    attempt('git', ['worktree', 'remove', '--force', worktree], root);
    attempt('git', ['branch', '-D', pull.branch], root);
    tracker.dropBranch(pull);
  }

  async function deliver(item: Item): Promise<{ reason?: string; pull?: Pull }> {
    const task = `issue-${item.id}`;
    // merged by someone else a moment ago, the issue is not closed yet: nothing to start
    const already = tracker.mergedPullOf(item);
    if (already) {
      log(`#${item.id} merged by someone else: ${already.url}, no session`, 'info');
      cleanup(item, already);
      appendFileSync(
        path.join(runDir, 'results.jsonl'),
        `${JSON.stringify({ issue: item.id, title: item.title, outcome: 'merged', pr: already.url, minutes: 0, sessions: [] })}\n`,
      );
      return { pull: already };
    }
    const worktree = path.join(path.dirname(root), `${path.basename(root)}-wt-${item.id}`);
    run('git', ['fetch', '--quiet', 'origin', BASE], root);
    if (!existsSync(worktree))
      run('git', ['worktree', 'add', '--detach', worktree, `origin/${BASE}`], root);
    const sessions: Session[] = [];
    let pull: Pull | undefined;
    let reason: string | undefined;
    const started = Date.now();
    // a pull request of an earlier run that changes a protected path, or two open pull requests of the item, are
    // handed over before a session is paid for; a failed read is no verdict here, the guard after the session asks again
    let earlier = tracker.pullOf(item);
    if (earlier) {
      let early = morePulls(earlier) ?? (await guard(earlier));
      let note: string | undefined;
      if (early?.startsWith('changes protected paths')) {
        note = await repairConflict(item, earlier, worktree, sessions);
        if (note) {
          // the repair may have changed the pull request: the guard runs again
          earlier = tracker.pullOf(item) ?? earlier;
          early = morePulls(earlier) ?? (await guard(earlier));
          if (early) early = `${note}, ${early}`;
          else log(`#${item.id} ${note}`, 'info');
        }
      }
      if (
        early &&
        (early.includes('changes protected paths') || early.startsWith(MORE_PULLS)) &&
        !signal.stopped
      ) {
        if (note)
          log(`#${item.id} ${note}`, note.startsWith('conflict repaired') ? 'info' : 'warn');
        appendFileSync(
          path.join(runDir, 'results.jsonl'),
          `${JSON.stringify({
            issue: item.id,
            title: item.title,
            outcome: 'aside',
            reason: early,
            pr: earlier.url,
            minutes: 0,
            sessions,
          })}\n`,
        );
        log(`#${item.id} worktree kept: ${worktree}`, 'warn');
        return { reason: early, pull: earlier };
      }
      if (signal.stopped) return { reason: 'stopped', pull: earlier };
    }
    const reviews: Review[] = [];
    let fixes = 0;
    let reviewFile: string | undefined;
    let repaired = false;
    let announced = false;
    // a pull request of an earlier run: the label says whether it is built, reviewed or merged next
    let next: Step = earlier ? resumeAt(item, earlier) : { step: 'implement' };
    if (next.step !== 'implement') log(`#${item.id} resumes at the ${next.step}`, 'info');
    else if (next.reviewFile) {
      log(`#${item.id} resumes with the recorded findings`, 'info');
      reviewFile = next.reviewFile;
    }
    for (;;) {
      const from = next;
      next = { step: 'implement' };
      let session: Session | undefined;
      const settle = () => {
        if (reason && session) reason = withBlocked(reason, session);
      };
      reason = undefined;
      if (from.step === 'implement') {
        mark(item, 'session-started');
        const ran = await runSession(item, worktree, sessions, implementer(item, reviewFile));
        reviewFile = undefined;
        // read after every implementer session: the next one (a fix round) starts without this file
        noteRisk(item.id, riskOf(resultFile(item)));
        session = ran.session;
        pull = tracker.pullOf(item);
        // a stopped or failed session never leads to a merge, also when a pull request is open
        if (signal.stopped) reason = 'stopped';
        else if (ran.reason) reason = ran.reason;
        else if (session.exit !== 0) reason = `session failed (exit ${session.exit})`;
        // the session asked a question: a pull request of an earlier run is not its answer
        else if (tracker.needsDecision(item)) reason = 'needs-decision';
        else if (!pull) {
          // merged by hand while the session ran: delivered, not set aside
          const byOther = tracker.mergedPullOf(item);
          if (byOther) {
            log(`#${item.id} merged by someone else: ${byOther.url}`, 'info');
            pull = byOther;
            break;
          }
          reason = 'session ended without a pull request';
        }
      } else {
        pull = tracker.pullOf(item);
        if (signal.stopped) reason = 'stopped';
        // closed or merged since the labels were read: the implementer looks at it
        else if (!pull) continue;
      }
      if (reason || !pull) {
        settle();
        break;
      }
      // before the review: a session never runs on a pull request the guard hands over, because a checkout of
      // protected paths (agent settings, hooks) would run with the rights of the loop
      reason = morePulls(pull) ?? (await guard(pull));
      await seeStop();
      // a stopped item keeps its label: what the guard said is asked again by the next run
      if (signal.stopped) reason = 'stopped';
      if (reason) {
        settle();
        break;
      }
      if (!announced) {
        announced = true;
        emit('step.finished', {
          task,
          step: { name: 'pr', text: 'pull request opened' },
          links: [{ rel: 'pull-request', url: pull.url, title: pull.title }],
        });
      }
      let head: string;
      if (from.step === 'merge') head = from.head;
      else {
        const round = reviews.length + 1;
        log(`#${item.id} pr: ${pull.url}, review round ${round}`, 'info');
        mark(item, 'pull-opened');
        const reviewed = await review(item, pull, round, sessions);
        if ('reason' in reviewed) {
          reason = reviewed.reason;
          if (reason === 'stopped') break;
        }
        const verdict = 'reason' in reviewed ? 'failed' : reviewed.verdict.verdict;
        reviews.push({ round, verdict });
        emit(
          'step.finished',
          { task, step: { name: `review-${round}`, text: `review round ${round}: ${verdict}` } },
          verdict === 'approve' ? 'success' : 'warning',
        );
        log(`#${item.id} review round ${round}: ${verdict}`, verdict === 'approve' ? 'ok' : 'warn');
        if ('reason' in reviewed) {
          settle();
          break;
        }
        // the mark first: a run that dies in between reviews again
        try {
          tracker.recordVerdict(pull, reviewed.verdict, reviewed.head, risks.get(item.id));
        } catch (error) {
          log(`#${item.id} review verdict not recorded: ${firstLine(error)}`, 'warn');
        }
        mark(item, `verdict-${reviewed.verdict.verdict}`);
        note(item, reviewNote(round, reviewed.verdict, reviewed.head, pull.url));
        if (reviewed.verdict.verdict === 'changes') {
          if (fixes >= FIX_ROUNDS) {
            // the findings are text of an agent: it never ends the reason, whose ending decides about a hand-over
            reason = `needs-decision: review still asks for changes after ${FIX_ROUNDS} fix rounds (${findingsLine(reviewed.verdict)})`;
            settle();
            break;
          }
          fixes += 1;
          reviewFile = reviewed.file;
          continue;
        }
        head = reviewed.head;
      }
      log(`#${item.id} approved, waits for checks`, 'info');
      const gated = await merge(pull, head, riskHold(item.id));
      reason = gated.reason;
      // a person closed it or has to look at it: no repair session
      if (!reason || reason === 'stopped' || reason === CLOSED || reason.endsWith(HANDS_OFF)) break;
      log(`#${item.id} ${reason}${repaired ? '' : ', one repair session'}`, 'warn');
      if (repaired) break;
      repaired = true;
      emit('step.finished', { task, step: { name: 'repair', text: reason } }, 'warning');
      if (!gated.conflict) continue;
      // a conflict, also one that another merge into the base caused: the repair session merges the base in
      const repair = await repairConflict(item, pull, worktree, sessions);
      noteRisk(item.id, riskOf(resultFile(item)));
      if (signal.stopped) {
        reason = 'stopped';
        break;
      }
      // no conflict any more by now: the same commit goes to the merge gate again
      if (!repair) next = { step: 'merge', head };
      else if (repair === 'conflict repaired') {
        // a new head: it is reviewed before it is merged
        log(`#${item.id} ${repair}`, 'info');
        next = { step: 'review' };
      } else {
        reason = repair;
        break;
      }
    }
    if (pull && !reason) {
      // merged: the worktree and the branches can go
      cleanup(item, pull);
    } else {
      // not merged: the worktree may hold work that is not pushed
      log(`#${item.id} worktree kept: ${worktree}`, 'warn');
    }
    const risk = risks.get(item.id);
    appendFileSync(
      path.join(runDir, 'results.jsonl'),
      `${JSON.stringify({
        issue: item.id,
        title: item.title,
        risk,
        outcome: !reason ? 'merged' : reason === 'stopped' ? 'stopped' : 'aside',
        reason,
        pr: pull?.url,
        minutes: Math.round((Date.now() - started) / 60_000),
        reviews,
        sessions,
      })}\n`,
    );
    return { reason, pull };
  }

  /** The tracker closes an issue a moment after its merge; until then it still blocks its dependents. */
  async function untilClosed(id: number): Promise<void> {
    for (let second = 0; second < 120 && !signal.stopped; second += 5) {
      let closed = false;
      try {
        closed = !tracker.items().some((item) => item.id === id);
      } catch {
        // asked again
      }
      if (closed) break;
      for (let wait = 0; wait < 5 && !signal.stopped; wait++) await sleep(1);
    }
  }

  /**
   * One repair session for a handed-over pull request that conflicts with the base (at most one per pull request and
   * run); the note goes into the hand-over reason and the line of the issue in results.jsonl. The loop never merges it.
   */
  async function repairHandedOver(nr: number): Promise<void> {
    const entry = handedPulls.get(nr);
    const reason = handedOver.get(nr);
    if (!entry || signal.stopped || harnessDead || !reason || reason.includes(MORE_PULLS)) return;
    const { item, pull } = entry;
    const worktree = path.join(path.dirname(root), `${path.basename(root)}-wt-${nr}`);
    if (!existsSync(worktree))
      run('git', ['worktree', 'add', '--detach', worktree, `origin/${BASE}`], root);
    const sessions: Session[] = [];
    const repaired = await repairConflict(item, pull, worktree, sessions).catch(
      (error) => `conflict not repaired: ${firstLine(error)}`,
    );
    if (!repaired) return;
    mark(item, 'handed-over');
    log(
      `#${nr} ${repaired}, handed over`,
      repaired.startsWith('conflict repaired') ? 'info' : 'warn',
    );
    handedOver.set(nr, `${repaired}, ${reason}`);
    tell(item, pull, `${repaired}, ${reason}`, true);
    // the line of the issue in results.jsonl says it too
    const file = path.join(runDir, 'results.jsonl');
    const rows = readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const row = JSON.parse(line) as Record<string, unknown>;
        if (row.issue !== nr || typeof row.reason !== 'string') return line;
        const all = [...((row.sessions as Session[]) ?? []), ...sessions];
        return JSON.stringify({ ...row, reason: `${repaired}, ${row.reason}`, sessions: all });
      });
    writeFileSync(file, `${rows.join('\n')}\n`);
  }

  /**
   * Nothing can start and pull requests are handed over: polls them every 60 s for up to HANDOVER_MINUTES.
   * A merged one counts as merged, a closed one is set aside, a conflicting one gets its repair session.
   * Returns true when one was merged or closed (the loop looks for the next issue), false on time over or stop.
   */
  async function awaitHandovers(): Promise<boolean> {
    if (HANDOVER_MINUTES === 0 || handedPulls.size === 0) return false;
    const until = Date.now() + HANDOVER_MINUTES * 60_000 * Math.max(TICK_MS / 1000, 0.0001);
    const names = () =>
      [...handedPulls.values()].map(({ item, pull }) => `#${item.id} ${pull.url}`).join(', ');
    log(
      `waiting for handed-over pull requests (up to ${HANDOVER_MINUTES} min): ${names()}`,
      'warn',
    );
    emit(
      'attention',
      {
        id: 'handover-wait',
        reason: 'deliver.handed-over',
        text: `waiting for you to merge: ${names()}`,
        needsYou: true,
        links: [...handedPulls.values()].map(({ pull }) => ({
          rel: 'pull-request',
          url: pull.url,
        })),
      },
      'warning',
    );
    while (!signal.stopped && !harnessDead && Date.now() < until) {
      let changed = false;
      for (const [nr, { item, pull }] of handedPulls) {
        let gate: Gate | undefined;

        try {
          gate = tracker.gate(pull);
        } catch {
          // a failing read is no verdict: asked again
        }
        if (signal.stopped) return false;
        const row = { issue: nr, title: item.title, pr: pull.url, minutes: 0, sessions: [] };
        const file = path.join(runDir, 'results.jsonl');
        if (gate?.state === 'merged') {
          handedOver.delete(nr);
          handedPulls.delete(nr);
          mergedByPerson.add(nr);
          merged.push(`#${nr} ${pull.url}`);
          log(`#${nr} merged by a person: ${pull.url}`, 'ok');
          mark(item, 'merged');
          appendFileSync(file, `${JSON.stringify({ ...row, outcome: 'merged' })}\n`);
          cleanup(item, pull);
          emitMerged(nr, pull.url);
          emit('progress', { done: merged.length, total, label: 'PBIs' });
          await untilClosed(nr);
          changed = true;
        } else if (gate?.state === 'closed') {
          handedOver.delete(nr);
          handedPulls.delete(nr);
          aside.set(nr, `closed by a person, ${pull.url}`);
          log(`#${nr} set aside: closed by a person, ${pull.url}`, 'bad');
          tell(item, pull, CLOSED, false);
          emitSetAside('aside', nr, pull.url, CLOSED);
          appendFileSync(
            file,
            `${JSON.stringify({ ...row, outcome: 'aside', reason: 'closed by a person' })}\n`,
          );
          changed = true;
        } else if (gate?.state === 'conflict') {
          await repairHandedOver(nr);
        }
      }
      if (changed || handedPulls.size === 0) return changed;
      for (let second = 0; second < 60 && !signal.stopped && Date.now() < until; second++)
        await sleep(1);
    }
    return false;
  }

  let cutNote = '';
  const baseExists = () =>
    attempt('git', ['ls-remote', '--exit-code', '--heads', 'origin', BASE], root) !== undefined;
  if (!baseExists()) {
    // after every release the merge deletes release/next: cut it again from the default branch, as github-release cut does
    if (BASE !== 'release/next') return ended(3, `${BASE} is missing on origin`);
    if (dryRun) {
      console.log(`${BASE} is missing on origin, the loop cuts it from the default branch`);
    } else {
      try {
        const target = tracker.defaultBranch();
        run('git', ['fetch', '--quiet', 'origin', target], root);
        run('git', ['push', '--quiet', 'origin', `origin/${target}:refs/heads/${BASE}`], root);
        cutNote = `${BASE} was missing on origin: cut from ${target}`;
      } catch (error) {
        return ended(3, `${BASE} is missing on origin and could not be cut: ${firstLine(error)}`);
      }
    }
  }

  const required = tracker.requiredChecks();
  if (required.length === 0 && !allowNoRequiredChecks) {
    return ended(
      3,
      `${BASE} requires no checks in ${tracker.repo}, so nothing guards the merge: add a ruleset with required checks, or pass --allow-no-required-checks`,
    );
  }

  if (dryRun) {
    try {
      for (const item of tracker.items()) {
        // where a milestone or a Feature selection took the item from
        const from = item.feature ? ` (Feature #${item.feature})` : milestone ? ' (milestone)' : '';
        console.log(`#${item.id} ${tracker.waitReason(item) ?? 'ready'}${from}: ${item.title}`);
      }
    } catch (error) {
      return ended(64, `tracker: ${firstLine(error)}`);
    }
    console.log(
      `harness: ${harnessName} (${harness.command({ prompt: '/deliver <nr> …', model: STANDARD.implement.model }).join(' ')})`,
    );
    console.log(
      `review: ${REVIEW.harnessName} (${REVIEW.harness.command({ prompt: '/deliver-review <nr> …', model: STANDARD.review.model, effort: REVIEW.effort }).join(' ')})`,
    );
    console.log(`models: ${MODEL_LINE}`);
    if (milestone)
      console.log(`retro: ${RETRO.enabled ? `after the last merge, model ${RETRO.model}` : 'off'}`);
    console.log(`tracker: ${tracker.name}, base: ${BASE}, parallel: ${PARALLEL}`);
    console.log(`required checks: ${required.join(', ') || 'none'}`);
    console.log(`session token: ${TOKEN_SOURCE ?? 'none, the session uses your login'}`);
    console.log(`protected paths: ${PROTECTED.join(' ')}`);
    return ended(0);
  }

  mkdirSync(runDir, { recursive: true });
  out.toFile(path.join(path.dirname(runDir), 'loop.log'));
  // the run id of the events is a UUIDv7 (agent-events contract); the run folder keeps `runId`
  const { run: eventRun, dir: eventDir, origin } = events.open();
  // OSC 7501 to the controlling terminal (ADR 0007): the events stay the source for displays
  const report = context.status;
  const statusTitle = titleOf(context.options);
  let blockedShown = false;
  const sessionsLine = () => `${slots.active} of ${slots.limit} sessions running`;
  emit = (type, body, tone) => {
    events.emit(type, body, tone);
    if (type === 'run.started') {
      report({ state: 'working', title: statusTitle });
    } else if (type === 'attention' && body?.needsYou) {
      blockedShown = true;
      report({
        state: 'blocked',
        kind: 'question',
        reason: blockedReason(String(body.id)),
        title: statusTitle,
        msg: String(body.text ?? ''),
      });
    } else if (type === 'deliver.merged' && mergedFields(body).risk === 'high') {
      blockedShown = true;
      const { issue, pr } = mergedFields(body);
      report({
        state: 'blocked',
        kind: 'question',
        reason: 'risk-high',
        title: statusTitle,
        msg: `#${issue} merged at risk high: ${String(pr)}`,
      });
    } else if (type === 'task.started' && blockedShown) {
      blockedShown = false;
      report({ state: 'working', title: statusTitle, msg: sessionsLine() });
    } else if (type === 'deliver.sessions' && !blockedShown) {
      // the number of running sessions; a blocked report stays until the next task starts
      report({ state: 'working', title: statusTitle, msg: sessionsLine() });
    } else if (type === 'run.finished') {
      report(finishReport(body, statusTitle, needsYou.length));
    }
  };
  log(
    `run ${runId} in ${tracker.repo}, models: ${MODEL_LINE}, results: ${path.join(runDir, 'results.jsonl')}`,
    'dim',
  );
  log(
    `events: run ${eventRun}${eventDir ? ` in ${eventDir}` : ', not written: no directory'}`,
    'dim',
  );
  log(
    `parallel: up to ${slots.limit} sessions at once${context.slots ? ' in this repository' : ''}, one merge at a time`,
    'dim',
  );
  if (cutNote) log(cutNote, 'info');
  if (!TOKEN_SOURCE) {
    log(
      'the session uses your own login: set DELIVER_APP_ID with DELIVER_APP_KEY_FILE or DELIVER_APP_KEY_COMMAND (GitHub App), or DELIVER_SESSION_TOKEN',
      'warn',
    );
  }
  emit('run.started', {
    profiles: ['deliver@2'],
    origin,
    host: {
      'jsonl-file.pid': String(process.pid),
      ...(process.env.POIMEN_TERMINAL_ID
        ? { 'poimen.terminal': process.env.POIMEN_TERMINAL_ID }
        : {}),
    },
    agent: { harness: harnessName, model: STANDARD.implement.model },
    subject: tracker.subject(),
  });

  const aside = new Map<number, string>();
  // handed over by rule (the guard): a person merges the pull request, it is no failure
  const handedOver = new Map<number, string>();
  const handedPulls = new Map<number, { item: Item; pull: Pull }>();
  // handed-over pull requests a person merged during the wait: nothing is left to look at
  const mergedByPerson = new Set<number>();
  const merged: string[] = [];
  let waiting: string[] = [];
  let total = 0;

  /** Why an attention blocks the run, as far as OSC 7501 names it. */
  function blockedReason(attention: string): BlockedReason | undefined {
    if (attention === 'handover-wait') return 'handover';
    const nr = Number(/^aside-(\d+)$/.exec(attention)?.[1]);
    if (handedOver.has(nr)) return 'handover';
    return aside.get(nr)?.startsWith('needs-decision') ? 'decision' : undefined;
  }
  /** The fields of `deliver.merged`, under `deliver` as the profile rule wants them. */
  type MergedFields = { repo: string; issue: number; pr?: string; risk?: string };
  /** The `deliver` object of the body of a `deliver.merged` event. */
  function mergedFields(body: Record<string, unknown> | undefined): MergedFields {
    return body?.deliver as MergedFields;
  }
  /** The events an orchestrator reacts to (contract: SKILL.md of `deliver`). */
  function emitMerged(issue: number, pr: string | undefined): void {
    const deliver: MergedFields = { repo: tracker.repo, issue, pr, risk: risks.get(issue) };
    emit('deliver.merged', { deliver }, 'success');
  }
  function emitSetAside(
    type: 'handover' | 'aside',
    issue: number,
    pr: string | undefined,
    why: string,
  ) {
    const reason = reasonCode(why);
    emit(
      `deliver.${type}`,
      {
        reason,
        // a line of an event is limited, and findings can be long
        text: why.slice(0, 1000),
        deliver: {
          repo: tracker.repo,
          issue,
          pr,
          ...(reason === 'deliver.needs-decision' && { hold: 'needs-decision' }),
        },
      },
      'warning',
    );
  }
  // The triage of an Objective run (#1127): one `deliver-triage` session per attention case, its result applied only
  // through `parseTriage`. Triage never merges and never writes an `agent:*` label.
  const TRIAGE = context.options.triage;
  const triaged: string[] = [];
  /** The items the triage took out of the run: the frontier does not start them again. */
  const dropped = new Set<number>();
  /** The prepared decisions and drafted follow-ups of the triage: they go to "needs you". */
  const triageNeeds: string[] = [];
  /** Judges the case in a session of its own and applies its result. `item`: the issue of the case. */
  async function triage(kase: TriageCase, item?: Item): Promise<void> {
    if (!TRIAGE || signal.stopped) return;
    const key = caseKey(kase);
    if (TRIAGE.seen.has(key)) return;
    TRIAGE.seen.add(key);
    const slug = caseSlug(kase);
    const label = kase.issue
      ? `#${kase.issue}`
      : kase.milestone
        ? `milestone ${kase.milestone}`
        : BASE;
    const fields = {
      repo: tracker.repo,
      case: kase.kind,
      ...(kase.issue !== undefined && { issue: kase.issue }),
      ...(kase.pr && { pr: kase.pr }),
      ...(kase.milestone && { milestone: kase.milestone }),
    };
    const caseFile = path.join(runDir, `${slug}.case.json`);
    const resultFile = path.join(runDir, `${slug}.result.json`);
    writeFileSync(caseFile, `${JSON.stringify(kase, null, 2)}\n`);
    emit('deliver.triage.started', { deliver: fields }, 'info');
    log(
      `${label} triage of the ${kase.kind} case (${REVIEW.harnessName}, ${MODELS.triage.model})`,
      'info',
    );
    const worktree = path.join(path.dirname(root), `${path.basename(root)}-wt-${slug}`);
    const drop = () => attempt('git', ['worktree', 'remove', '--force', worktree], root);
    let content: string | undefined;
    let failed = '';
    try {
      run('git', ['fetch', '--quiet', 'origin', BASE], root);
      drop();
      run('git', ['worktree', 'add', '--quiet', '--detach', worktree, `origin/${BASE}`], root);
      const session = await startSession(undefined, worktree, path.join(runDir, `${slug}.jsonl`), {
        prompt: `/deliver-triage --case ${promptPath(caseFile)} --result ${promptPath(resultFile)}`,
        label: `${label} triage`,
        harness: REVIEW.harness,
        model: MODELS.triage.model,
        tier: MODELS.triage.tier,
        effort: REVIEW.effort,
        deny: TRIAGE_DENY,
        output: { name: 'DELIVER_TRIAGE_FILE', file: resultFile },
        delivered: () => existsSync(resultFile),
      });
      if (session.timedOut) failed = 'session timeout';
      else if (session.exit !== 0) failed = `session failed (exit ${session.exit})`;
      else if (existsSync(resultFile)) content = readFileSync(resultFile, 'utf8');
    } catch (error) {
      failed = firstLine(error);
    } finally {
      drop();
    }
    // a stop ends the run: the case is judged again by the next run
    if (signal.stopped) return;
    let result: Triage = failed
      ? {
          action: 'needs-owner',
          reason: `triage failed: ${failed}`,
          options: ['Decide the case yourself'],
        }
      : parseTriage(content);
    const owner = (reason: string): Triage => ({
      action: 'needs-owner',
      reason,
      options: ['Decide the case yourself'],
    });
    if (OWNER_ONLY.includes(kase.reason) && result.action !== 'draft-issue')
      result =
        result.action === 'needs-owner'
          ? result
          : owner(`${result.action} refused: the case is the owner's (${kase.reason})`);
    if (result.action === 'answer' && (kase.kind !== 'needs-decision' || !item))
      result = owner('answer refused: only a needs-decision of an issue is answered');
    if (result.action === 'drop' && !item) result = owner('drop refused: the case names no issue');
    if (result.action === 'rerun-ci' && TRIAGE.reruns.has(`${tracker.repo}:${result.job}`))
      result = owner(`rerun-ci refused: job ${result.job} was re-run in this run already`);
    const resolved = () => {
      if (item) emit('attention.resolved', { id: `aside-${item.id}` }, 'neutral');
    };
    try {
      if (result.action === 'answer' && item) {
        tracker.commentOnce(item, ANSWER_MARKER, answerComment(result));
        tracker.removeLabel(item, 'needs-decision');
        aside.set(
          item.id,
          'needs-decision answered by the triage, label removed: the next run starts it',
        );
        triaged.push(`#${item.id} answered: needs-decision removed`);
        resolved();
      } else if (result.action === 'drop' && item) {
        aside.delete(item.id);
        handedOver.delete(item.id);
        handedPulls.delete(item.id);
        dropped.add(item.id);
        triaged.push(`#${item.id} dropped from the run: ${result.reason}`);
        resolved();
      } else if (result.action === 'rerun-ci') {
        TRIAGE.reruns.add(`${tracker.repo}:${result.job}`);
        tracker.rerunJob(result.job, await actEnv());
        triaged.push(`${label} CI job ${result.job} re-run: ${result.reason}`);
      }
    } catch (error) {
      result = owner(`${result.action} not applied: ${firstLine(error)}`);
    }
    const text = preparedText(kase, result);
    if (text) {
      const file = path.join(runDir, `${slug}.md`);
      writeFileSync(file, text);
      triageNeeds.push(
        result.action === 'draft-issue'
          ? `${label} follow-up drafted: ${result.title} (${file})`
          : `${label} decide: ${(result as Extract<Triage, { action: 'needs-owner' }>).reason} (${file})`,
      );
    }
    log(`${label} triage: ${result.action}`, text ? 'warn' : 'ok');
    emit(
      'deliver.triage.done',
      { deliver: { ...fields, action: result.action } },
      text ? 'warning' : 'success',
    );
  }

  try {
    const created = tracker.syncStageLabels();
    if (created.length) log(`labels created: ${created.join(', ')}`, 'info');
  } catch (error) {
    log(`agent:* labels not synced: ${firstLine(error)}`, 'warn');
  }
  signal.watch(path.join(runDir, 'stop'));

  // The base branch is checked before every issue: a red base would set every pull request aside.
  // A red one is rerun once, then a Bug is filed and delivered first. At most BASE_REPAIRS repairs per run.
  const BASE_REPAIRS = 2;
  let repairs = 0;
  let repairBug: Item | undefined;
  let baseBlocked = '';
  const readBase = (): BaseState | undefined => {
    try {
      return tracker.baseState();
    } catch (error) {
      // a failing tracker call is no verdict: the issue starts
      log(`${BASE} state unreadable: ${firstLine(error)}`, 'warn');
      return undefined;
    }
  };
  /** Reads the base until its checks are no longer pending (or the merge time is over). */
  async function settleBase(): Promise<BaseState | undefined> {
    const start = Date.now();
    for (;;) {
      const state = readBase();
      if (!state || state.state !== 'pending' || signal.stopped) return state;
      if (Date.now() - start > MERGE_MINUTES * 60_000) return state;
      for (let second = 0; second < 30 && !signal.stopped; second++) await sleep(1);
    }
  }
  /** The environment of the session token for the calls that change something. A failed mint throws. */
  async function actEnv(): Promise<Record<string, string>> {
    const token = tokenSource ? (await tokenSource.current()).token : FIXED_TOKEN;
    return token ? tracker.sessionEnv(token) : {};
  }
  const names = (failed: BaseState['failed']) => [...new Set(failed.map((f) => f.name))].join(', ');
  /** The Bug to deliver first when the base is red, else nothing. Sets `baseBlocked` when the run must end. */
  async function checkBase(): Promise<Item | undefined> {
    let state = readBase();
    if (state?.state === 'pending' && repairBug) state = await settleBase();
    if (!state || state.state === 'pending') return undefined;
    if (state.state === 'green') {
      repairBug = undefined;
      return undefined;
    }
    const blocked = (failed: BaseState['failed'], why = '') => {
      baseBlocked = `${BASE} is red (${names(failed)})${why}${repairBug ? `, Bug ${repairBug.url}` : ''}`;
      return undefined;
    };
    // red again after its repair: no second rerun, no second Bug
    if (repairBug) return blocked(state.failed, ' after its repair');
    log(`${BASE} is red (${names(state.failed)}), reruns the failed jobs`, 'warn');
    try {
      tracker.rerunFailed(await actEnv());
      for (let second = 0; second < 30 && !signal.stopped; second++) await sleep(1);
      state = (await settleBase()) ?? state;
    } catch (error) {
      log(`${BASE} rerun failed: ${firstLine(error)}`, 'warn');
    }
    if (state.state !== 'red') {
      if (state.state === 'green') log(`${BASE}: green after rerun (flake)`, 'ok');
      return undefined;
    }
    if (repairs >= BASE_REPAIRS) return blocked(state.failed, `: ${BASE_REPAIRS} repairs used`);
    try {
      repairBug = tracker.reportBaseRed(state.failed, await actEnv());
    } catch (error) {
      return blocked(state.failed, `: no Bug filed (${firstLine(error)})`);
    }
    repairs += 1;
    log(`${BASE} is still red: delivers ${repairBug.url} first`, 'warn');
    return repairBug;
  }

  /** What follows the work of an item: it is merged, stopped, handed over or set aside. */
  async function settle(item: Item, { reason, pull }: { reason?: string; pull?: Pull }) {
    if (!reason) {
      merged.push(
        `#${item.id} ${pull?.url}${risks.has(item.id) ? ` (risk ${risks.get(item.id)})` : ''}`,
      );
      log(`#${item.id} merged: ${pull?.url}`, 'ok');
      mark(item, 'merged');
      if (risks.get(item.id) === 'high') tell(item, pull, 'high risk: merged', false);
      emit(
        'task.finished',
        { task: `issue-${item.id}`, outcome: 'succeeded', text: 'merged' },
        'success',
      );
      emitMerged(item.id, pull?.url);
      emit('progress', { done: merged.length, total, label: 'PBIs' });
      // its dependents become ready once the tracker closed it
      await untilClosed(item.id);
      return;
    }
    if (reason === 'stopped') {
      log(`#${item.id} stopped: not merged${pull ? `, ${pull.url}` : ''}`, 'warn');
      emit('task.finished', { task: `issue-${item.id}`, outcome: 'cancelled', text: 'stopped' });
    } else {
      const planned = reason.endsWith(HANDS_OFF);
      const why = planned ? reason.slice(0, -HANDS_OFF.length) : reason;
      (planned ? handedOver : aside).set(item.id, `${why}${pull ? `, ${pull.url}` : ''}`);
      if (planned && pull) handedPulls.set(item.id, { item, pull });
      mark(item, planned ? 'handed-over' : 'set-aside');
      tell(item, pull, why, planned);
      log(
        planned
          ? `#${item.id} handed over: ${why}, merge it yourself`
          : `#${item.id} set aside: ${reason}`,
        planned ? 'warn' : 'bad',
      );
      emit(
        'task.finished',
        { task: `issue-${item.id}`, outcome: 'skipped', text: reason },
        'warning',
      );
      emitSetAside(planned ? 'handover' : 'aside', item.id, pull?.url, why);
      // after the task: an attention of a finished task would close with it
      emit(
        'attention',
        {
          id: `aside-${item.id}`,
          reason: 'deliver.set-aside',
          text: `#${item.id} set aside: ${reason}`,
          needsYou: true,
          links: [{ rel: pull ? 'pull-request' : 'issue', url: pull?.url ?? item.url }],
        },
        'warning',
      );
      // an Objective run: the triage judges a hand-over or a needs-decision (it counts as a session of the item)
      if (planned || reasonCode(why) === 'deliver.needs-decision') {
        await triage(
          {
            kind: planned ? 'handover' : 'needs-decision',
            repo: tracker.repo,
            issue: item.id,
            ...(pull && { pr: pull.url }),
            reason: reasonCode(why),
            text: why.slice(0, 1000),
          },
          item,
        );
      }
    }
    emit('progress', { done: merged.length, total, label: 'PBIs' });
  }

  // The frontier: up to `slots.limit` items are worked at once, each in its own worktree. It is read again whenever one
  // of them ends (merged, set aside, handed over): an item becomes ready when its blocker is merged and closed.
  const running = new Map<number, Promise<void>>();
  /** The items started in this run (--max counts them). */
  let started = 0;
  /** The open items no frontier of this run has seen: added to the milestone after its last read. */
  const grown = (): Item[] => {
    const known = (id: number) =>
      merged.some((line) => line.startsWith(`#${id} `)) ||
      aside.has(id) ||
      handedOver.has(id) ||
      dropped.has(id) ||
      waiting.some((line) => line.startsWith(`#${id} `));
    return tracker.items().filter((item) => !known(item.id));
  };
  // A milestone can grow during the run: before its release gate it is read again, and new items are worked first.
  for (let first = true; ; first = false) {
    try {
      for (; !signal.stopped && !harnessDead; first = false) {
        // an issue closes a moment after its merge: do not pick it again
        const open = tracker
          .items()
          .filter((item) => !merged.some((line) => line.startsWith(`#${item.id} `)));
        if (first) {
          total = open.length;
          emit('progress', { done: 0, total, label: 'PBIs' });
        }
        const maxed = MAX > 0 && started >= MAX;
        // the Bug of a red base runs alone: nothing else starts, and the base is read again after it
        const repairing = repairBug !== undefined && running.has(repairBug.id);
        // how many items start now: the free places, within --max
        const room =
          maxed || repairing
            ? 0
            : Math.min(slots.limit - running.size, MAX > 0 ? MAX - started : slots.limit);
        let starts: Item[] = [];
        let candidates = open.filter(
          (item) =>
            !running.has(item.id) &&
            !aside.has(item.id) &&
            !handedOver.has(item.id) &&
            !dropped.has(item.id),
        );
        if (room > 0) {
          const bug = await checkBase();
          if (baseBlocked) break;
          if (bug) {
            // the Bug of a red base goes first (it may not be in the selection); the others wait for it
            starts = [open.find((item) => item.id === bug.id) ?? bug];
            candidates = [];
          }
        }
        waiting = [];
        for (const { item, reason } of inPickOrder(candidates, (i) => tracker.waitReason(i))) {
          if (reason) waiting.push(`#${item.id} ${reason}`);
          else if (starts.length < room) starts.push(item);
        }
        for (const item of starts) {
          log(`#${item.id} start: ${item.title} (${open.length} open)`, 'info');
          // x: the issues finished, set aside or running so far, plus this one; the log file is read at a fixed width
          const begun = merged.length + aside.size + handedOver.size + running.size + 1;
          log(
            progressLine(begun, total, process.stdout.isTTY ? (process.stdout.columns ?? 80) : 80),
            'info',
          );
          emit('task.started', { task: `issue-${item.id}`, subject: tracker.itemSubject(item) });
          started += 1;
          // a failing tracker or git call sets the issue aside, it does not end the run
          const work = deliver(item)
            .catch((error): { reason?: string; pull?: Pull } => ({
              // a call that the stop broke off (Ctrl-C also reaches `git`) sets nothing aside
              reason: signal.stopped ? 'stopped' : `error: ${firstLine(error)}`,
            }))
            .then((result) => settle(item, result))
            .finally(() => running.delete(item.id));
          running.set(item.id, work);
        }
        if (running.size === 0) {
          // nothing runs and nothing can start: only handed-over pull requests are left (and what they block)
          if (maxed || !(await awaitHandovers())) break;
          continue;
        }
        // the frontier is read again when an item ends
        await Promise.race(running.values());
      }
      // a stop, a dead harness or a red base starts nothing more: the running items end first
      await Promise.all(running.values());
    } catch (error) {
      // the sessions of the other items end with the run; their items stay resumable by their labels
      if (running.size) {
        signal.request();
        await Promise.allSettled(running.values());
      }
      emit('run.finished', { outcome: 'failed', text: firstLine(error).slice(0, 300) }, 'danger');
      log(`run failed: ${firstLine(error)}`, 'bad');
      return ended(1);
    }
    if (!milestone || signal.stopped || harnessDead || baseBlocked || (MAX > 0 && started >= MAX))
      break;
    let added: Item[] = [];
    try {
      added = grown();
    } catch (error) {
      // the gate below reads the milestone again and reports a failure
      log(`milestone ${milestone} not read again: ${firstLine(error)}`, 'warn');
    }
    if (added.length === 0) break;
    total += added.length;
    emit('progress', { done: merged.length, total, label: 'PBIs' });
    log(
      `milestone ${milestone} grew during the run: ${added.map((item) => `#${item.id}`).join(', ')} before its release gate`,
      'info',
    );
  }

  // Before the run ends: a pull request handed over earlier may conflict with the base by now. One repair session
  // per pull request and run; the loop never merges it, the person does.
  if (!signal.stopped && !harnessDead && !baseBlocked) {
    for (const nr of handedPulls.keys()) await repairHandedOver(nr);
  }

  // A fully delivered milestone ends with the retro and the release pull request, which a person merges.
  let retroResult: Retro = {};
  const retroFailed = (why: string) => {
    retroResult = { failed: why };
    log(`retro failed: ${why}`, 'warn');
  };
  let needsYou: string[] = [];
  let releaseError = '';
  let releaseUrl: string | undefined;
  const complete =
    Boolean(milestone) &&
    !signal.stopped &&
    aside.size === 0 &&
    handedOver.size === 0 &&
    !baseBlocked &&
    waiting.length === 0;
  if (complete) {
    try {
      if (tracker.items().length === 0 && merged.length === 0 && tracker.releaseCommits() === 0) {
        log(
          `milestone ${milestone} has no open issue and ${BASE} has no commit beyond ${tracker.defaultBranch()}, nothing to deliver`,
          'info',
        );
      } else if (dropped.size > 0) {
        log(
          `milestone ${milestone} is not released: the triage took ${[...dropped].map((nr) => `#${nr}`).join(', ')} out of the run`,
          'warn',
        );
      } else {
        const { evidence } = releaseGate({ tracker, milestone: milestone as string });
        const { unread } = evidence;
        if (unread.open) throw new Error(unread.open);
        // an item that is open by now: no release; the publish state and a ready pull request hold nothing back here
        if (evidence.open?.length === 0) {
          // a pull request into the base that is not of this milestone would be lost with the release branch: a person decides
          if (unread.pulls)
            log(`open pull requests into ${BASE} not read: ${unread.pulls}`, 'warn');
          for (const pull of evidence.pulls ?? []) {
            needsYou.push(
              `${pull.url} is open into ${BASE} and not in ${milestone}: merge, close or retarget it first`,
            );
          }
          let release: Pull | undefined;
          if (RETRO.enabled) {
            try {
              // once per release: the tracker says whether the retro comment exists
              if (unread.retroDone) retroFailed(`retro comment not read: ${unread.retroDone}`);
              else if (evidence.retroDone) {
                retroResult = { url: evidence.retro };
                log(`retro: already posted, ${evidence.retro}`, 'info');
              } else {
                // without a Feature the retro comments on the release pull request: that one has to exist first
                if (!tracker.hasRetroFeature()) release = tracker.ensureReleasePull();
                retroResult = await retro(milestone as string, release);
                if (retroResult.failed) retroFailed(retroResult.failed);
                else if (retroResult.url) log(`retro: ${retroResult.url}`, 'info');
              }
            } catch (error) {
              retroFailed(firstLine(error));
            }
            await seeStop();
          }
          // a stop request during the retro ends the run: the next run opens the release pull request
          if (signal.stopped && !release) throw new Error('stopped');
          release ??= tracker.ensureReleasePull();
          if (retroResult.url) {
            try {
              tracker.linkRetro(release, retroResult.url);
            } catch (error) {
              retroFailed(`release pull request body not updated: ${firstLine(error)}`);
            }
          }
          releaseUrl = release.url;
          log(`release pull request: ${release.url} (never merged by the loop)`, 'info');
          emit('step.finished', {
            task: 'release',
            step: { name: 'release-pr', text: 'release pull request' },
            links: [{ rel: 'pull-request', url: release.url, title: release.title }],
          });
          if (unread.releaseTests) throw new Error(unread.releaseTests);
          for (const test of evidence.releaseTests ?? []) {
            needsYou.push(`#${test.id} ${test.title}`);
            emit(
              'attention',
              {
                id: `release-test-${test.id}`,
                reason: 'deliver.release-test',
                text: `#${test.id} release test is open: a person tests the release candidate`,
                needsYou: true,
                links: [{ rel: 'issue', url: test.url }],
              },
              'warning',
            );
          }
        }
      }
    } catch (error) {
      needsYou = [];
      if (!signal.stopped) {
        log(`release pull request: ${firstLine(error)}`, 'bad');
        releaseError = firstLine(error);
      }
    }
  }

  // The attention cases of the end of the run: a red base, a milestone that is not done. The milestone event comes
  // before its triage, which a reader follows.
  if (baseBlocked) {
    emit(
      'attention',
      {
        id: 'base-red',
        reason: 'deliver.base-red',
        text: `blocked: ${baseBlocked}`,
        needsYou: true,
        links: repairBug ? [{ rel: 'issue', url: repairBug.url }] : [],
      },
      'warning',
    );
    await triage(
      {
        kind: 'blocked',
        repo: tracker.repo,
        ...(repairBug && { issue: repairBug.id }),
        reason: 'deliver.base-red',
        text: `blocked: ${baseBlocked}`.slice(0, 1000),
      },
      repairBug,
    );
  }
  const clean =
    !baseBlocked &&
    !releaseError &&
    aside.size === 0 &&
    handedOver.size === 0 &&
    waiting.length === 0;
  if (milestone && !signal.stopped) {
    emit(
      'deliver.milestone.done',
      {
        deliver: {
          repo: tracker.repo,
          milestone,
          merged: merged.length,
          aside: aside.size,
          pr: releaseUrl,
        },
      },
      clean && !releaseError ? 'success' : 'warning',
    );
    if (!clean)
      await triage({
        kind: 'milestone-done',
        repo: tracker.repo,
        milestone,
        reason: 'deliver.incomplete',
        text: `milestone ${milestone}: merged ${merged.length}, set aside ${aside.size}, handed over ${handedOver.size}, waiting ${waiting.length}${releaseError ? `, release pull request failed: ${releaseError}` : ''}${releaseUrl ? `, release ${releaseUrl}` : ''}`.slice(
          0,
          1000,
        ),
      });
  }

  // an issue of level high is listed first: a person looks at it before the rest. A handed-over one has its own
  // line, and one a person merged was looked at.
  const isHigh = (nr: number) => risks.get(nr) === 'high';
  const highRisk = [...risks.keys()]
    .filter((nr) => isHigh(nr) && !handedOver.has(nr) && !mergedByPerson.has(nr))
    .map((nr) => `#${nr} risk high`);
  const handedLines = [...handedOver]
    .sort(([a], [b]) => Number(isHigh(b)) - Number(isHigh(a)))
    .map(([nr, why]) => `#${nr} ${why}`);
  needsYou = [...highRisk, ...handedLines, ...needsYou, ...triageNeeds];
  // the open PBIs that wait for a handed-over pull request: their blockers name its issue
  const waitingFor = new Map<number, string[]>();
  for (const nr of handedOver.keys()) {
    const dependents = waiting.filter((line) => {
      const blockers = /^#\d+ blocked by (.*)$/.exec(line)?.[1]?.split(', ') ?? [];
      return blockers.some((ref) => ref === `#${nr}` || ref === `${tracker.repo}#${nr}`);
    });
    if (dependents.length) waitingFor.set(nr, dependents);
  }
  say('');
  say(
    `merged (${merged.length}):${merged.map((line) => `\n  ${line}`).join('')}`,
    merged.length ? 'ok' : undefined,
  );
  say(
    `set aside (${aside.size}):${[...aside].map(([nr, why]) => `\n  #${nr} ${why}`).join('')}`,
    aside.size ? 'bad' : undefined,
  );
  say(
    `waiting (${waiting.length}):${waiting.map((line) => `\n  ${line}`).join('')}`,
    waiting.length ? 'warn' : undefined,
  );
  if (triaged.length)
    say(`triaged (${triaged.length}):${triaged.map((line) => `\n  ${line}`).join('')}`, 'info');
  if (releaseError) say(`release pull request failed: ${releaseError}`, 'bad');
  if (retroResult.failed) say(`retro failed: ${retroResult.failed}`, 'warn');
  say(
    `needs you (${needsYou.length}):${needsYou.map((line) => `\n  ${line}`).join('')}`,
    needsYou.length ? 'warn' : undefined,
  );
  if (baseBlocked) {
    say(`blocked: ${baseBlocked}`, 'bad');
  }
  for (const [nr, dependents] of waitingFor) {
    say(
      `waiting for the handed-over pull request of #${nr} (${dependents.length}):${dependents.map((line) => `\n  ${line}`).join('')}`,
      'warn',
    );
  }
  if (handedOver.size) {
    say(
      'next step: merge the pull request above yourself, then run /deliver again or start the loop again with the same arguments',
      'warn',
    );
  }
  // done, blocked (a red base, an issue set aside, an error) or waiting for a handed-over pull request
  const status = harnessDead
    ? 'failed'
    : clean
      ? 'done'
      : !baseBlocked && !releaseError && aside.size === 0 && handedOver.size > 0
        ? 'waiting-for-handed-over'
        : 'blocked';
  if (!signal.stopped) {
    say(
      status === 'done'
        ? 'done'
        : status === 'failed'
          ? `failed: the harness failed ${harnessDead?.count} times in a row, last exit code ${harnessDead?.exit}`
          : status === 'blocked'
            ? 'blocked'
            : 'waiting for a handed-over PR: merge it, then run /deliver again',
      status === 'done' ? 'ok' : status === 'blocked' || status === 'failed' ? 'bad' : 'warn',
    );
  }
  appendFileSync(
    path.join(runDir, 'results.jsonl'),
    `${JSON.stringify({
      run: 'finished',
      status,
      handedOver: [...handedOver.keys()],
      waitingFor: Object.fromEntries(waitingFor),
      ...(retroResult.url && { retro: retroResult.url }),
      ...(retroResult.failed && { retroFailed: retroResult.failed }),
    })}\n`,
  );
  // An incomplete run (issues set aside or waiting) is no success: the agent-events format has no
  // other outcome for it than `failed`; the counts are in the text. OSC 7501 shows it as `done` with
  // `tone=warning`; only `reason: 'deliver.harness'` (the harness failed) is an `error`.
  emit(
    'run.finished',
    {
      outcome: signal.stopped ? 'cancelled' : clean ? 'succeeded' : 'failed',
      ...(signal.stopped || clean
        ? {}
        : { reason: status === 'failed' ? 'deliver.harness' : 'deliver.incomplete' }),
      text: `${status}: merged ${merged.length}, set aside ${aside.size}, waiting ${waiting.length}${needsYou.length ? `, needs you ${needsYou.length}` : ''}`,
    },
    signal.stopped ? 'neutral' : clean ? 'success' : 'warning',
  );

  const exitCode = signal.stopped
    ? 130
    : clean
      ? 0
      : status === 'failed'
        ? 5
        : status === 'waiting-for-handed-over'
          ? 3
          : 2;
  return { exitCode, status, merged, aside, waiting, needsYou, handedOver, triaged };
}
