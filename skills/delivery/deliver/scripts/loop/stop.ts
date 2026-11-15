// Stop rules of the loop as pure functions over the states before and after an iteration.
import type { LoopState } from './state.ts';

export type StopResult = 'done' | 'max reached' | 'blocked' | 'no progress';

const EXIT_CODES: Record<string, number> = {
  done: 0,
  'max reached': 0,
  stopped: 0,
  'no progress': 1,
  blocked: 2,
};

export function exitCodeFor(result: string): number {
  return EXIT_CODES[result] ?? 0;
}

/** Nothing open: done (blocked when the release review is paused); open but nothing ready: blocked. */
export function getStopReason(state: LoopState): 'done' | 'blocked' | null {
  if (state.open === 0) return state.paused ? 'blocked' : 'done';
  if (state.ready.length === 0) return 'blocked';
  return null;
}

/** The eligible set did not change over an iteration. */
export function noProgress(before: LoopState, after: LoopState): boolean {
  return before.eligible.join(',') === after.eligible.join(',');
}

/** Result after iteration `iterations` (null: continue). Order: no progress, done/blocked, max reached. */
export function evaluateStop(
  before: LoopState,
  after: LoopState,
  iterations: number,
  max: number,
): StopResult | null {
  if (noProgress(before, after)) return 'no progress';
  const reason = getStopReason(after);
  if (reason) return reason;
  if (max > 0 && iterations >= max) return 'max reached';
  return null;
}
