// The run of an Objective (`deliver-loop --objective <owner>/<repo>#<nr>`, ADR 0011, #1041): one frontier over the
// repositories of the Objective. A unit is the milestone of a repository's Features (a Feature without a milestone is
// a unit of its own); `runUnit` works it with `runRepository`, and every repository of the run shares the slots of
// `deliver.parallel`. The units of one repository run one after the other, in milestone order. A unit starts once
// every `Requires:` of the Objective and of its Features holds; a waiting unit is read again every `pollSeconds`. A
// repository that waits for a person (a hand-over, a release test, its release pull request) holds back only the
// units that require it: the others go on. Before a repository ends, the Objective is read again and a new milestone
// of its Features joins the frontier. The run ends when nothing runs and nothing else can start: what is left needs
// you. It never merges a release pull request. Reads the Objective through the tracker (objective.mts). One events run
// and a summary per repository report it (objective-report.mts); an Objective whose open Features are all deferred ends
// `partly released`.

import type { Checkouts } from './checkout.mts';
import {
  type Objective,
  type Requirement,
  milestoneKey,
  parseObjective,
  readObjective,
  requirementState,
  startOrder,
} from './objective.mts';
import { type Counts, type ObjectiveStream, sayRepositories } from './objective-report.mts';
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
  /** The events of the run; the units write through views of it. */
  events: ObjectiveStream;
  /** Fields of `run.started`: `host` and `agent`. */
  started: Record<string, unknown>;
  /** The number of running and waiting repositories, after every step of the frontier. */
  onCounts: (counts: Counts) => void;
};

export type ObjectiveResult = {
  /** 0 done (also partly released), 2 blocked (a unit ended blocked or with an error), 3 needs you, 5 harness failed, 130 stopped. */
  exitCode: number;
  waiting: string[];
  needsYou: string[];
  /** Nothing is left to do, but deferred Features are open. */
  partlyReleased: boolean;
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
  /** The first pending unit waits for a requirement. */
  blockedUpstream?: boolean;
  merged: string[];
  aside: string[];
  /** The waiting issues of its worked units. */
  waiting: string[];
  /** What the triage applied in its units. */
  triaged: string[];
  needsYou: string[];
};

export async function runObjective(context: ObjectiveRunContext): Promise<ObjectiveResult> {
  const { reader, signal, say, log } = context;
  let objective = readObjective(context.ref, reader);
  const repositories: Repository[] = startOrder(objective).map((name) => {
    const pending = unitsOf(objective, name);
    return {
      name,
      pending,
      seen: new Set(pending.map(unitKey)),
      merged: [],
      aside: [],
      waiting: [],
      triaged: [],
      needsYou: [],
    };
  });
  const { events } = context;
  events.open();
  const { title, url } = objective.objective;
  events.emit('run.started', {
    profiles: ['deliver@2'],
    origin: events.open().origin,
    ...context.started,
    subject: {
      kind: 'github.issue',
      id: `${parseObjective(context.ref).repo}#${parseObjective(context.ref).number}`,
      title: title || context.ref,
      url,
    },
  });
  log(
    `objective ${context.ref}: ${repositories.map((r) => `${r.name} (${r.pending.map((u) => u.milestone ?? `#${u.feature}`).join(', ') || 'no unit'})`).join(', ')}`,
    'info',
  );
  const needsYou: string[] = [];
  /** The open `deliver.waiting-upstream` attentions, by unit key. */
  const attentions = new Map<string, { text: string; needsYou: boolean }>();
  const needs = (repo: Repository, unit: string, line: string): void => {
    needsYou.push(`${unit}: ${line}`);
    repo.needsYou.push(`${unit.slice(repo.name.length + 1)}: ${line}`);
  };
  const resolve = (unit: Unit): void => {
    if (!attentions.delete(unitKey(unit))) return;
    events.emit('attention.resolved', { id: `waiting-${unitKey(unit)}` }, 'neutral', unit.repo);
  };
  /** Raises the attention of a waiting unit; a changed one replaces the open one (readers ignore a repeated id). */
  const raise = (unit: Unit, text: string, forYou: boolean): void => {
    const open = attentions.get(unitKey(unit));
    if (open?.text === text && open.needsYou === forYou) return;
    resolve(unit);
    attentions.set(unitKey(unit), { text, needsYou: forYou });
    events.emit(
      'attention',
      {
        id: `waiting-${unitKey(unit)}`,
        reason: 'deliver.waiting-upstream',
        text: text.slice(0, 1000),
        needsYou: forYou,
      },
      forYou ? 'warning' : 'info',
      unit.repo,
    );
  };
  /** A repository that cannot be worked. */
  const failed = (repo: Repository, unit: Unit, text: string): void => {
    events.emit(
      'attention',
      {
        id: `failed-${unitKey(unit)}`,
        reason: 'deliver.error',
        text: text.slice(0, 1000),
        needsYou: true,
      },
      'warning',
      repo.name,
    );
  };
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
        repo.needsYou.push(checkout.needsYou);
        failed(repo, unit, checkout.needsYou);
        repo.halted = 'checkout failed';
        blocked = true;
        return;
      }
      repo.root = checkout.root;
    }
    // stopped during the checkout: the unit does not start, so it changes nothing on the tracker or on origin
    if (signal.stopped) {
      repo.halted = 'stopped';
      return;
    }
    let result: RepositoryResult;
    try {
      result = await context.runUnit(unit, repo.root);
    } catch (error) {
      needs(repo, name, firstLine(error));
      failed(repo, unit, `${name}: ${firstLine(error)}`);
      repo.halted = 'error';
      blocked = true;
      return;
    }
    for (const line of result.needsYou) needs(repo, name, line);
    repo.merged.push(...result.merged);
    repo.aside.push(...[...result.aside].map(([nr, why]) => `#${nr} ${why}`));
    repo.waiting.push(...result.waiting);
    repo.triaged.push(...(result.triaged ?? []));
    const merged = `merged ${result.merged.length}`;
    if (result.exitCode === 0) {
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
    if (!result.needsYou.length) needs(repo, name, `${status}, ${merged}`);
    // a run that ended before it started wrote no event of its own
    if (!result.status) failed(repo, unit, `${name} ${status}`);
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
      repo.blockedUpstream = reasons.length > 0;
      if (reasons.length > 0) {
        const line = `${unitName(unit)}: ${reasons.join(', ')}`;
        waiting.push(line);
        if (shown.get(unitKey(unit)) !== line) log(`${line}, waits`, 'dim');
        shown.set(unitKey(unit), line);
        raise(unit, line, attentions.get(unitKey(unit))?.needsYou ?? false);
        continue;
      }
      resolve(unit);
      repo.pending.shift();
      log(`${unitName(unit)} starts`, 'info');
      repo.active = work(repo, unit).finally(() => {
        repo.active = undefined;
      });
    }
    const active = repositories.flatMap((repo) => (repo.active ? [repo.active] : []));
    context.onCounts(countsOf(repositories));
    if (active.length === 0) {
      // only a person can move what still waits
      for (const repo of repositories) {
        const unit = repo.halted ? undefined : repo.pending[0];
        const text = unit && attentions.get(unitKey(unit))?.text;
        if (unit && text) raise(unit, text, true);
      }
      // nothing runs: only a person can meet what is left (a release); the run waits for one at most `idlePolls`
      if (waiting.length === 0 || idle >= context.idlePolls) break;
      idle += 1;
    } else idle = 0;
    await Promise.race([...active, context.sleep(context.pollSeconds)]);
  }
  await Promise.all(repositories.flatMap((repo) => (repo.active ? [repo.active] : [])));

  context.onCounts(countsOf(repositories));

  // the units a halted repository did not start wait for it; a repository's waits are listed in its section
  for (const repo of repositories) {
    if (!repo.halted || repo.halted === 'done') continue;
    for (const unit of repo.pending) waiting.push(`${unitName(unit)}: after ${repo.halted}`);
  }
  waiting = [...new Set(waiting)];
  for (const line of waiting) {
    if (needsYou.includes(line)) continue;
    needsYou.push(line);
    const repo = repositories.find((r) => line.startsWith(`${r.name} `));
    repo?.needsYou.push(line.slice(repo.name.length + 1));
  }

  // read once more: a Feature may have been closed or deferred during the run
  let read = true;
  try {
    objective = readObjective(context.ref, reader);
  } catch (error) {
    read = false;
    log(`objective ${context.ref} not read again: ${firstLine(error)}`, 'warn');
  }
  const open = objective.features.filter((feature) => feature.state === 'open');
  const exitCode = signal.stopped
    ? 130
    : harnessFailed
      ? 5
      : blocked
        ? 2
        : needsYou.length > 0
          ? 3
          : 0;
  const partlyReleased =
    read && exitCode === 0 && open.length > 0 && open.every((feature) => feature.deferred);

  say('');
  say(`objective ${context.ref}`, 'bold');
  sayRepositories(
    repositories.map((repo) => ({
      repo: repo.name,
      merged: repo.merged,
      aside: repo.aside,
      waiting: [
        ...repo.waiting,
        ...waiting
          .filter((line) => line.startsWith(`${repo.name} `))
          .map((line) => line.slice(repo.name.length + 1)),
      ],
      deferred: open
        .filter((f) => f.deferred && f.repo.toLowerCase() === repo.name.toLowerCase())
        .map((f) => `#${f.number} ${f.title}`),
      triaged: repo.triaged,
      needsYou: repo.needsYou,
    })),
    say,
  );
  const verdict =
    exitCode === 0
      ? partlyReleased
        ? 'partly released'
        : 'done'
      : exitCode === 5
        ? 'failed: the harness failed'
        : exitCode === 2
          ? 'blocked'
          : exitCode === 3
            ? 'needs you: nothing else can start'
            : 'stopped';
  if (!signal.stopped)
    say(
      verdict,
      exitCode === 0 && !partlyReleased ? 'ok' : exitCode === 2 || exitCode === 5 ? 'bad' : 'warn',
    );
  const count = (key: 'merged' | 'aside') =>
    repositories.reduce((sum, repo) => sum + repo[key].length, 0);
  events.emit(
    'run.finished',
    {
      outcome: signal.stopped ? 'cancelled' : exitCode === 0 ? 'succeeded' : 'failed',
      ...(signal.stopped || exitCode === 0
        ? {}
        : { reason: exitCode === 5 ? 'deliver.harness' : 'deliver.incomplete' }),
      text: `${verdict}: merged ${count('merged')}, set aside ${count('aside')}, waiting ${waiting.length}${needsYou.length ? `, needs you ${needsYou.length}` : ''}`,
    },
    signal.stopped ? 'neutral' : exitCode === 0 ? 'success' : 'warning',
  );
  return { exitCode, waiting, needsYou, partlyReleased };
}

/** A repository runs a unit, waits (for a requirement or a person), or has nothing left. */
function countsOf(repositories: Repository[]): Counts {
  return {
    running: repositories.filter((repo) => repo.active).length,
    waiting: repositories.filter(
      (repo) =>
        !repo.active &&
        (repo.halted ? repo.halted !== 'done' && repo.halted !== 'stopped' : repo.blockedUpstream),
    ).length,
  };
}
