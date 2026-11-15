// Stop rules of the loop as pure functions over the states before and after an iteration.
import type { LoopState } from './state.ts';

export type StopResult = 'done' | 'max reached' | 'blocked';

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
