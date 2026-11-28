// The run of an Objective (`deliver-loop --objective <owner>/<repo>#<nr>`, ADR 0011, #1041): one frontier over the
// repositories of the Objective. A unit is the milestone of a repository's Features (a Feature without a milestone is
// a unit of its own); `runUnit` works it with `runRepository`, and every repository of the run shares the slots of
// `deliver.parallel`. The units of one repository run one after the other, in milestone order. A unit starts once
// every `Requires:` of the Objective and of its Features holds; a waiting unit is read again every `pollSeconds`. A
// repository that waits for a person (a hand-over, a release test, its release pull request) holds back only the
// units that require it: the others go on. Before a repository ends, the Objective is read again and a new milestone
// of its Features joins the frontier. The run ends when nothing runs and nothing else can start: what is left needs
// you. It never merges a release pull request. Reads the Objective through the tracker (objective.mts).

import type { Checkouts } from './checkout.mts';
import {
  type Objective,
  type Requirement,
  milestoneKey,
  readObjective,
  requirementState,
  startOrder,
} from './objective.mts';
import type { RepositoryResult, Tone } from './run-repository.mts';
import type { StopSignal } from './stop-signal.mts';
import type { ObjectiveReader } from './tracker.mts';

/** What one `runRepository` call works: a milestone of the repository, else one Feature without a milestone. */
export type Unit = {
  repo: string;
  milestone?: string;
  feature?: number;
  /** The `Requires:` lines of the Objective and of the Features of the unit. */
  requires: Requirement[];
};

export type ObjectiveRunContext = {
  ref: string;
  reader: ObjectiveReader;
  checkouts: Checkouts;
  /** Works the unit in the checkout `root`: `runRepository` with the shared slots and merge locks. */
  runUnit: (unit: Unit, root: string) => Promise<RepositoryResult>;
  /** The seconds between two reads of the requirements of a waiting unit. */
  pollSeconds: number;
  /** How many polls the run waits for a person when nothing runs (`handoverMinutes`); 0 ends it at once. */
  idlePolls: number;
  /** Resolves after `seconds` (scaled like every pause of the loop) or earlier on a stop request. */
  sleep: (seconds: number) => Promise<void>;
  signal: StopSignal;
  say: (line: string, tone?: Tone) => void;
  log: (line: string, tone?: Tone) => void;
};

export type ObjectiveResult = {
  /** 0 done, 2 blocked (a unit ended blocked or with an error), 3 needs you, 5 harness failed, 130 stopped. */
  exitCode: number;
  done: string[];
  waiting: string[];
  needsYou: string[];
};

export const unitName = (unit: Unit): string =>
  `${unit.repo} ${unit.milestone ?? `#${unit.feature}`}`;
const unitKey = (unit: Unit): string =>
  `${unit.repo.toLowerCase()}${unit.milestone ? `@${milestoneKey(unit.milestone) ?? unit.milestone}` : `#${unit.feature}`}`;
const firstLine = (error: unknown): string =>
  String((error as Error)?.message ?? error).split('\n')[0] ?? '';

/**
 * The units of a repository in milestone order, then the Features without a milestone by number. Closed and deferred
 * Features are no work. A unit's own milestone is no requirement of it.
 */
export function unitsOf(objective: Objective, repo: string): Unit[] {
  const units = new Map<string, Unit>();
  for (const feature of objective.features) {
    if (feature.repo.toLowerCase() !== repo.toLowerCase()) continue;
    if (feature.deferred || feature.state !== 'open') continue;
    const unit: Unit = feature.milestone
      ? { repo, milestone: feature.milestone, requires: [] }
      : { repo, feature: feature.number, requires: [] };
    const key = unitKey(unit);
    const known = units.get(key) ?? { ...unit, requires: [...objective.requires] };
    for (const req of feature.requires) {
      const own =
        'milestone' in req &&
        req.repo.toLowerCase() === repo.toLowerCase() &&
        !!known.milestone &&
        milestoneKey(req.milestone) === milestoneKey(known.milestone);
      if (!own && !known.requires.some((r) => JSON.stringify(r) === JSON.stringify(req)))
        known.requires.push(req);
    }
    units.set(key, known);
  }
  const order = (unit: Unit): number[] =>
    unit.milestone
      ? [0, ...(milestoneKey(unit.milestone) ?? '').split('.').map(Number)]
      : [1, unit.feature ?? 0];
  return [...units.values()].sort((a, b) => {
    const [x, y] = [order(a), order(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const diff = (x[i] ?? -1) - (y[i] ?? -1);
      if (diff !== 0) return diff;
    }
    return 0;
  });
}

type Repository = {
  name: string;
  pending: Unit[];
  seen: Set<string>;
  root?: string;
  active?: Promise<void>;
  /** Why no further unit of the repository starts in this run. */
  halted?: string;
};

export async function runObjective(context: ObjectiveRunContext): Promise<ObjectiveResult> {
  const { reader, signal, say, log } = context;
  let objective = readObjective(context.ref, reader);
  const repositories: Repository[] = startOrder(objective).map((name) => {
    const pending = unitsOf(objective, name);
    return { name, pending, seen: new Set(pending.map(unitKey)) };
  });
  log(
    `objective ${context.ref}: ${repositories.map((r) => `${r.name} (${r.pending.map((u) => u.milestone ?? `#${u.feature}`).join(', ') || 'no unit'})`).join(', ')}`,
    'info',
  );
  const done: string[] = [];
  const needsYou: string[] = [];
  let blocked = false;
  let harnessFailed = false;
  let waiting: string[] = [];
  const shown = new Map<string, string>();

  /** Why the unit cannot start now: its requirements that do not hold. A failed read is a reason too. */
  const waitsOf = (unit: Unit): string[] => {
    try {
      return unit.requires.flatMap((req) => {
        const state = requirementState(req, reader);
        return state.state === 'waiting' ? [state.reason] : [];
      });
    } catch (error) {
      return [`requirements not read: ${firstLine(error)}`];
    }
  };

  /** The next units of a repository whose units are worked: a milestone added to its Features since the last read. */
  const reread = (repo: Repository): Unit[] => {
    try {
      objective = readObjective(context.ref, reader);
    } catch (error) {
      log(`objective ${context.ref} not read again: ${firstLine(error)}`, 'warn');
      return [];
    }
    const added = unitsOf(objective, repo.name).filter((unit) => !repo.seen.has(unitKey(unit)));
    for (const unit of added) repo.seen.add(unitKey(unit));
    if (added.length)
      log(`${repo.name}: new in the objective: ${added.map(unitName).join(', ')}`, 'info');
    return added;
  };

  async function work(repo: Repository, unit: Unit): Promise<void> {
    const name = unitName(unit);
    if (!repo.root) {
      const checkout = await context.checkouts.checkout(repo.name);
      if ('needsYou' in checkout) {
        needsYou.push(checkout.needsYou);
        repo.halted = 'checkout failed';
        blocked = true;
        return;
      }
      repo.root = checkout.root;
    }
    let result: RepositoryResult;
    try {
      result = await context.runUnit(unit, repo.root);
    } catch (error) {
      needsYou.push(`${name}: ${firstLine(error)}`);
      repo.halted = 'error';
      blocked = true;
      return;
    }
    needsYou.push(...result.needsYou.map((line) => `${name}: ${line}`));
    const merged = `merged ${result.merged.length}`;
    if (result.exitCode === 0) {
      done.push(`${name}: done, ${merged}`);
      log(`${name} done, ${merged}`, 'ok');
      return;
    }
    if (result.exitCode === 130) {
      repo.halted = 'stopped';
      return;
    }
    if (result.exitCode === 5) harnessFailed = true;
    // the repository waits for a person: a hand-over, an issue set aside, a red base; its dependents wait with it
    const status = result.status ?? `exit ${result.exitCode}`;
    repo.halted = `${name} ${status}`;
    if (result.exitCode !== 3) blocked = true;
    if (!result.needsYou.length) needsYou.push(`${name}: ${status}, ${merged}`);
    log(`${name} ${status}, ${merged}: its dependents wait`, 'warn');
  }

  let idle = 0;
  while (!signal.stopped && !harnessFailed) {
    waiting = [];
    for (const repo of repositories) {
      if (repo.active || repo.halted) continue;
      if (repo.pending.length === 0) repo.pending = reread(repo);
      const unit = repo.pending[0];
      if (!unit) {
        repo.halted = 'done';
        continue;
      }
      const reasons = waitsOf(unit);
      if (reasons.length > 0) {
        const line = `${unitName(unit)}: ${reasons.join(', ')}`;
        waiting.push(line);
        if (shown.get(unitKey(unit)) !== line) log(`${line}, waits`, 'dim');
        shown.set(unitKey(unit), line);
        continue;
      }
      repo.pending.shift();
      log(`${unitName(unit)} starts`, 'info');
      repo.active = work(repo, unit).finally(() => {
        repo.active = undefined;
      });
    }
    const active = repositories.flatMap((repo) => (repo.active ? [repo.active] : []));
    if (active.length === 0) {
      // nothing runs: only a person can meet what is left (a release); the run waits for one at most `idlePolls`
      if (waiting.length === 0 || idle >= context.idlePolls) break;
      idle += 1;
    } else idle = 0;
    await Promise.race([...active, context.sleep(context.pollSeconds)]);
  }
  await Promise.all(repositories.flatMap((repo) => (repo.active ? [repo.active] : [])));

  // the units a halted repository did not start wait for it
  for (const repo of repositories) {
    if (!repo.halted || repo.halted === 'done') continue;
    for (const unit of repo.pending) waiting.push(`${unitName(unit)}: after ${repo.halted}`);
  }
  waiting = [...new Set(waiting)];
  for (const line of waiting) if (!needsYou.includes(line)) needsYou.push(line);

  say('');
  say(`objective ${context.ref}`, 'bold');
  say(
    `done (${done.length}):${done.map((l) => `\n  ${l}`).join('')}`,
    done.length ? 'ok' : undefined,
  );
  say(
    `waiting (${waiting.length}):${waiting.map((l) => `\n  ${l}`).join('')}`,
    waiting.length ? 'warn' : undefined,
  );
  say(
    `needs you (${needsYou.length}):${needsYou.map((l) => `\n  ${l}`).join('')}`,
    needsYou.length ? 'warn' : undefined,
  );
  const exitCode = signal.stopped
    ? 130
    : harnessFailed
      ? 5
      : blocked
        ? 2
        : needsYou.length > 0
          ? 3
          : 0;
  if (!signal.stopped)
    say(
      exitCode === 0
        ? 'done'
        : exitCode === 5
          ? 'failed: the harness failed'
          : exitCode === 2
            ? 'blocked'
            : 'needs you: nothing else can start',
      exitCode === 0 ? 'ok' : exitCode === 3 ? 'warn' : 'bad',
    );
  return { exitCode, done, waiting, needsYou };
}
