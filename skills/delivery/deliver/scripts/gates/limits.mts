// The limits gate (references/gates.md): whether one more fix round, review retry, conflict repair or session after a
// timeout is allowed for an issue. It counts the `step.started` events with `deliver.counted` of the run, which the loop
// writes before the session it counts starts; it never keeps a count of its own.
// CLI: `node limits.mts <run> <issue> <kind>`, the events of `<run>` in the events directory (event-dir.mts).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { eventsDirectory } from '../event-dir.mts';
import { type GateResult, gateMain, UsageError } from './result.mts';

/** Fix rounds per issue and run; the next `changes` verdict sets the issue aside. */
export const FIX_ROUNDS = 2;
/** Review sessions per review round: a missing or invalid verdict gets one more. */
export const REVIEW_ATTEMPTS = 2;
/** Conflict repair sessions per issue and run. */
export const CONFLICT_REPAIRS = 1;
/** Sessions after a session timeout per issue and run; the next timeout sets the issue aside. */
export const TIMEOUT_RETRIES = 1;
/** Repairs of a red base branch per run (counted by the loop, not an issue limit). */
export const BASE_REPAIRS = 2;

/** How many counted sessions each kind allows: per issue and run, `review` per review round. */
export const LIMITS = {
  fix: FIX_ROUNDS,
  review: REVIEW_ATTEMPTS - 1,
  conflict: CONFLICT_REPAIRS,
  timeout: TIMEOUT_RETRIES,
} as const;
export type LimitKind = keyof typeof LIMITS;
export const LIMIT_KINDS = Object.keys(LIMITS) as LimitKind[];

export type RunEvent = Record<string, unknown> & { type?: unknown };

const OWNER_REASON: Record<LimitKind, string> = {
  fix: `needs-decision: review still asks for changes after ${FIX_ROUNDS} fix rounds`,
  review: `review failed after ${REVIEW_ATTEMPTS} attempts`,
  conflict: `conflict repair used: ${CONFLICT_REPAIRS} per run`,
  timeout: 'session timeout',
};

const deliverOf = (event: RunEvent) =>
  (event.deliver && typeof event.deliver === 'object' ? event.deliver : {}) as Record<
    string,
    unknown
  >;
const stepOf = (event: RunEvent) =>
  (event.step && typeof event.step === 'object' ? event.step : {}) as Record<string, unknown>;

/**
 * Whether an event is about `issue`: its task is `issue-<n>`, or `<repo>:issue-<n>` in an Objective run. With `repo`,
 * an event of another repository never counts; without it, every repository does.
 */
function ofIssue(event: RunEvent, issue: number, repo: string | undefined): boolean {
  const task = event.task;
  if (typeof task !== 'string') return false;
  const own = `issue-${issue}`;
  if (task === own) {
    const eventRepo = deliverOf(event).repo;
    return !repo || eventRepo === undefined || eventRepo === repo;
  }
  if (repo) return task === `${repo}:${own}`;
  return task.endsWith(`:${own}`);
}

/** The review round that runs now: one after the finished `review-<n>` steps of the issue. */
export function reviewRound(events: RunEvent[], issue: number, repo?: string): number {
  const finished = events.filter(
    (event) =>
      event.type === 'step.finished' &&
      ofIssue(event, issue, repo) &&
      /^review-\d+$/.test(String(stepOf(event).name)),
  );
  return finished.length + 1;
}

/** The counted sessions of `kind` for `issue`: those of the current review round for `review`. */
export function countOf(events: RunEvent[], issue: number, kind: LimitKind, repo?: string): number {
  const round = kind === 'review' ? reviewRound(events, issue, repo) : undefined;
  return events.filter(
    (event) =>
      event.type === 'step.started' &&
      deliverOf(event).counted === kind &&
      ofIssue(event, issue, repo) &&
      (round === undefined || stepOf(event).n === round),
  ).length;
}

/**
 * `pass` while the counted sessions of `kind` for `issue` are below its limit, `owner` once it is reached, `usage`
 * for an unknown kind or issue. `events` are those of one run.
 */
export function limits({
  events,
  issue,
  kind,
  repo,
}: {
  events: RunEvent[];
  issue: number;
  kind: string;
  repo?: string;
}): GateResult {
  if (!Object.hasOwn(LIMITS, kind))
    return {
      result: 'usage',
      reason: `unknown kind ${JSON.stringify(kind)}: one of ${LIMIT_KINDS.join(', ')}`,
      evidence: { kind },
    };
  if (!Number.isInteger(issue) || issue < 1)
    return { result: 'usage', reason: `no issue number: ${issue}`, evidence: { issue } };
  const known = kind as LimitKind;
  const limit = LIMITS[known];
  const count = countOf(events, issue, known, repo);
  const evidence: Record<string, unknown> = { kind, issue, count, limit };
  if (repo) evidence.repo = repo;
  if (known === 'review') evidence.round = reviewRound(events, issue, repo);
  if (count < limit)
    return { result: 'pass', reason: `${kind} ${count + 1} of ${limit} allowed`, evidence };
  return { result: 'owner', reason: OWNER_REASON[known], evidence };
}

/** The events of `<dir>/<run>.jsonl`; `undefined` when the file cannot be read. Lines that are no JSON are skipped. */
export function readRunEvents(dir: string, run: string): RunEvent[] | undefined {
  let text: string;
  try {
    text = readFileSync(path.join(dir, `${run}.jsonl`), 'utf8');
  } catch {
    return undefined;
  }
  const events: RunEvent[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line) as unknown;
      if (event && typeof event === 'object' && !Array.isArray(event))
        events.push(event as RunEvent);
    } catch {
      // an incomplete last line or a foreign line does not count
    }
  }
  return events;
}

const RUN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

/** The CLI: `<run> <issue> <kind>`, `<issue>` a number or `<owner>/<repo>#<number>`. */
export function limitsCli(args: string[], env: NodeJS.ProcessEnv = process.env): GateResult {
  if (args.length !== 3) throw new UsageError('usage: limits.mts <run> <issue> <kind>');
  const [run, issueArg, kind] = args as [string, string, string];
  if (!RUN.test(run)) throw new UsageError(`no run id: ${run}`);
  const match = /^(?:([^/\s#]+\/[^/\s#]+)#)?([1-9][0-9]*)$/.exec(issueArg);
  if (!match) throw new UsageError(`no issue: ${issueArg} (a number or <owner>/<repo>#<number>)`);
  if (!Object.hasOwn(LIMITS, kind)) return limits({ events: [], issue: 1, kind });
  const dir = eventsDirectory(env);
  if (!dir) throw new UsageError('no events directory: set AGENT_EVENTS_DIR');
  const events = readRunEvents(dir, run);
  if (!events) throw new UsageError(`no events of run ${run} in ${dir}`);
  return limits({ events, issue: Number(match[2]), kind, repo: match[1] });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await gateMain(limitsCli);
