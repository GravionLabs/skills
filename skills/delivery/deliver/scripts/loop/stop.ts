// Stop rules of the loop as pure functions over the states before and after an iteration.
import type { LoopState } from './state.ts';

export type StopResult = 'done' | 'max reached' | 'blocked' | 'failed';

const EXIT_CODES: Record<string, number> = {
  done: 0,
  'max reached': 0,
  stopped: 0,
  'no progress': 1,
  blocked: 2,
  failed: 5,
};

export function exitCodeFor(result: string): number {
  return EXIT_CODES[result] ?? 0;
}

/**
 * Nothing open: done (blocked when the release review is paused); open but no ready PBI that was not set aside: blocked.
 * `setAside`: PBIs set aside for the rest of the run (#655); they stay open and are never ready.
 */
export function getStopReason(
  state: LoopState,
  setAside: number[] = [],
): 'done' | 'blocked' | null {
  if (state.open === 0) return state.paused ? 'blocked' : 'done';
  if (state.ready.filter((n) => !setAside.includes(n)).length === 0) return 'blocked';
  return null;
}

/** The PBI the next iteration takes: the first ready one that was not set aside (null: none). */
export function nextReady(state: LoopState, setAside: number[] = []): number | null {
  return state.ready.find((n) => !setAside.includes(n)) ?? null;
}

/** #655: the iterated PBI is still open and does not merge: it is set aside for the rest of the run. */
export function shouldSetAside(after: LoopState, nr: number, merging: number[] = []): boolean {
  return after.openNrs.includes(nr) && !merging.includes(nr);
}

/**
 * Result after iteration `iterations` (null: continue). Order: done/blocked, max reached. There is no `no progress` result in
 * milestone and target mode: an unchanged PBI is set aside (`shouldSetAside`) and the next ready one is taken.
 */
export function evaluateStop(
  after: LoopState,
  iterations: number,
  max: number,
  setAside: number[] = [],
): StopResult | null {
  const reason = getStopReason(after, setAside);
  if (reason) return reason;
  if (max > 0 && iterations >= max) return 'max reached';
  return null;
}

/** #672: waits in minutes after the 1st, 2nd, ... harness failure in a row; the 3rd failure ends the run `failed`. */
export const HARNESS_RETRY_MINUTES = [5, 15, 60];
export const MAX_HARNESS_FAILURES = 3;
export const DEFAULT_SESSION_TIMEOUT_MINUTES = 120;

export type SessionEnd = { exitCode: number; stepFinished: boolean; timedOut: boolean };
export type SessionVerdict = 'ok' | 'timeout' | 'harness failure';

/**
 * #672: how a session ended. Stopped after deliver.sessionTimeoutMinutes: timeout; an exit other than 0 without a
 * step.finished event of its iteration: harness failure (the PBI is not set aside); else ok (the PBI rules decide).
 */
export function classifySession(end: SessionEnd): SessionVerdict {
  if (end.timedOut) return 'timeout';
  if (end.exitCode !== 0 && !end.stepFinished) return 'harness failure';
  return 'ok';
}

export type HarnessAction =
  | { action: 'retry'; waitMinutes: number }
  | { action: 'fail'; cause: string };

/** After the `failuresInRow`-th harness failure in a row: retry the same PBI after a wait, or end the run `failed`. */
export function harnessFailureAction(
  failuresInRow: number,
  exitCode: number,
  waits: number[] = HARNESS_RETRY_MINUTES,
): HarnessAction {
  if (failuresInRow >= MAX_HARNESS_FAILURES) {
    return {
      action: 'fail',
      cause: `the harness failed ${failuresInRow} times in a row (last exit ${exitCode})`,
    };
  }
  return { action: 'retry', waitMinutes: waits[Math.min(failuresInRow, waits.length) - 1] };
}

/** After a session timeout of a PBI (`timeouts` counted with this one): one more session, the second one sets it aside. */
export function timeoutAction(timeouts: number): 'retry' | 'set aside' {
  return timeouts < 2 ? 'retry' : 'set aside';
}

/** deliver.sessionTimeoutMinutes of .agents/config.json: a number above 0, else the default 120. */
export function sessionTimeoutMinutes(config: any): number {
  const v = config?.deliver?.sessionTimeoutMinutes;
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : DEFAULT_SESSION_TIMEOUT_MINUTES;
}
