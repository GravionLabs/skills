// What an Objective run reports (#1041 p8): one run folder, one events stream and one terminal state for the
// repositories of the Objective, and the summary per repository. Each unit (`runRepository`) writes through a view of
// the stream: its run is the run of the Objective, so its `run.started` and `run.finished` are dropped, every event
// carries `deliver.objective` and `deliver.repo`, task and attention ids are qualified by the repository (issue numbers
// repeat across repositories) and `progress` counts all units.
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import type { Origin } from './event-dir.mts';
import type { Tone as EventTone } from './events.mts';
import type { Report } from './program-status.mts';
import type { EventSink } from './run-repository.mts';

/** The events of an Objective run. */
export type ObjectiveStream = {
  open: EventSink['open'];
  /** An event of the run; `repo` names the repository it is about. */
  emit: (type: string, body?: Record<string, unknown>, tone?: EventTone, repo?: string) => void;
  /** The view of one unit; `id` tells its attentions from those of other units of the repository. */
  unit: (repo: string, id: string) => EventSink;
};

export function objectiveStream(sink: EventSink, objective: string): ObjectiveStream {
  let opened: { run: string; dir: string | undefined; origin: Origin } | undefined;
  const progress = new Map<string, { done: number; total: number }>();
  const emit: ObjectiveStream['emit'] = (type, body = {}, tone, repo) => {
    const deliver = {
      ...(body.deliver as Record<string, unknown> | undefined),
      objective,
      ...(repo && { repo }),
    };
    sink.emit(type, { ...body, deliver }, tone);
  };
  const open = () => (opened ??= sink.open());
  return {
    open,
    emit,
    unit: (repo, id) => ({
      open,
      emit: (type, body = {}, tone) => {
        if (type === 'run.started' || type === 'run.finished') return;
        const own: Record<string, unknown> = { ...body };
        if (typeof own.task === 'string') own.task = `${repo}:${own.task}`;
        if (type.startsWith('attention')) own.id = `${repo}@${id}:${String(own.id)}`;
        if (type === 'progress' && own.task === undefined) {
          progress.set(`${repo}@${id}`, { done: Number(own.done), total: Number(own.total) });
          const all = [...progress.values()];
          own.done = all.reduce((sum, p) => sum + p.done, 0);
          own.total = all.reduce((sum, p) => sum + p.total, 0);
        }
        emit(type, own, tone, repo);
      },
    }),
  };
}

export type Counts = { running: number; waiting: number };
const countsText = ({ running, waiting }: Counts) =>
  `repositories: ${running} running, ${waiting} waiting`;

/**
 * The OSC 7501 state of an Objective run: the title is the Objective, the message counts the running and the waiting
 * repositories. It is `blocked` while a unit needs the owner, or while nothing runs and repositories wait.
 */
export function objectiveStatus(title: string, send: (report: Report) => void) {
  let counts: Counts = { running: 0, waiting: 0 };
  const blocked = new Map<string, Report>();
  let last = '';
  const show = () => {
    const [unit] = blocked.values();
    const text = countsText(counts);
    const report: Report = unit
      ? { ...unit, title, msg: unit.msg ? `${text}; ${unit.msg}` : text }
      : counts.running === 0 && counts.waiting > 0
        ? { state: 'blocked', kind: 'question', title, msg: text }
        : { state: 'working', title, msg: text };
    const key = JSON.stringify(report);
    if (key === last) return;
    last = key;
    send(report);
  };
  return {
    counts(next: Counts): void {
      counts = next;
      show();
    },
    /** A report of the unit `id`; none: the unit ended. */
    unit(id: string, report?: Report): void {
      if (report?.state === 'blocked') blocked.set(id, report);
      else if (!report || report.state === 'working') {
        if (!blocked.delete(id)) return;
      } else return;
      show();
    },
    /** The report of the end of the run. */
    finish(exitCode: number, needsYou: number): void {
      const msg = countsText(counts);
      send(
        exitCode === 130
          ? { state: 'idle', title }
          : exitCode === 0
            ? { state: 'done', title, msg }
            : exitCode === 5 || exitCode === 1
              ? { state: 'error', title, msg }
              : { state: 'done', tone: 'warning', title, msg: `needs you ${needsYou}; ${msg}` },
      );
    },
  };
}

/** What the summary says about one repository. */
export type RepositorySummary = {
  repo: string;
  merged: string[];
  aside: string[];
  waiting: string[];
  deferred: string[];
  /** What the triage applied: an answer, an item dropped from the run (with the reason), a CI job re-run. */
  triaged: string[];
  needsYou: string[];
};

const GROUPS = [
  ['merged', 'merged', 'ok'],
  ['set aside', 'aside', 'bad'],
  ['waiting', 'waiting', 'warn'],
  ['deferred', 'deferred', 'dim'],
  ['triaged', 'triaged', 'info'],
  ['needs you', 'needsYou', 'warn'],
] as const;

/** One section per repository, each with every group and its count. */
export function sayRepositories(
  repositories: RepositorySummary[],
  say: (line: string, tone?: 'ok' | 'bad' | 'warn' | 'info' | 'dim' | 'bold') => void,
): void {
  for (const summary of repositories) {
    say(summary.repo, 'bold');
    for (const [label, key, tone] of GROUPS) {
      const entries = summary[key];
      say(
        `  ${label} (${entries.length}):${entries.map((line) => `\n    ${line}`).join('')}`,
        entries.length ? tone : undefined,
      );
    }
  }
}

/**
 * The run folder of an Objective run: `<events directory>/deliver/<run>`, without an events directory
 * `<git-common-dir>/deliver/<run>`. Each repository has the folder `<owner>/<repo>` below it (`results.jsonl`,
 * issue, verdict and result files).
 */
export function objectiveFolders(
  eventsDir: string | undefined,
  commonDir: string,
  run: string,
): { run: string; repository: (repo: string) => string; earlier: (repo: string) => string[] } {
  const root = path.join(eventsDir ?? commonDir, 'deliver');
  const folder = path.join(root, run);
  const repository = (name: string) => path.join(folder, ...name.split('/'));
  return {
    run: folder,
    repository,
    // the folders of the same repository in this and earlier Objective runs: their results hold risk levels
    earlier: (name) =>
      existsSync(root)
        ? readdirSync(root).map((other) => path.join(root, other, ...name.split('/')))
        : [],
  };
}
