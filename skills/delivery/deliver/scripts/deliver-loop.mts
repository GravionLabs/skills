#!/usr/bin/env node
// deliver loop: the command line. It parses the flags, reads the project config, loads the tracker and the token
// source and runs the repository once (run-repository.mts, which holds the loop itself), then exits with its code.
import { mkdirSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { appSettings, tokenSource as makeSource, tokenSources } from './app-token.mts';
import { cloneCheckouts } from './checkout.mts';
import { eventsDirectory, pruneRuns, runOrigin } from './event-dir.mts';
import { type Emit, openEvents, uuid7 } from './events.mts';
import { appMint } from './gates/app-token.mts';
import { mergeBase } from './gates/merge-base.mts';
import { type Report, finishReport, programStatus } from './program-status.mts';
import { HARNESSES } from './harness.mts';
import { adoptLegacyEnv, unknownConfigKeys } from './legacy.mts';
import { protectedList } from './protected-paths.mts';
import { parseObjective, planObjective } from './objective.mts';
import { objectiveFolders, objectiveStatus, objectiveStream } from './objective-report.mts';
import { type Unit, runObjective, unitName } from './objective-run.mts';
import { MergeLocks, Slots } from './parallel.mts';
import { triageRun } from './triage.mts';
import { RISK_LEVELS, type ReviewSettings, retroSettings, reviewSettings } from './review.mts';
import { type HarnessName, readLayers } from './resolve-model.mts';
import {
  type EventSink,
  type Output,
  type RepositoryOptions,
  attempt,
  createOutput,
  firstLine,
  run,
  runRepository,
  titleOf,
} from './run-repository.mts';
import { sessionModels } from './session-models.mts';
import { StopSignal } from './stop-signal.mts';
import { loadTracker } from './tracker.mts';

// A waiting unit of an Objective run reads its requirements again after this many seconds.
const OBJECTIVE_POLL_SECONDS = 60;
// before anything reads the environment; the warnings are printed once the log exists
const legacyWarnings = adoptLegacyEnv();

const parsed = (() => {
  try {
    return parseArgs({
      options: {
        milestone: { type: 'string' },
        feature: { type: 'string' },
        issues: { type: 'string' },
        objective: { type: 'string' },
        base: { type: 'string' },
        tracker: { type: 'string' },
        harness: { type: 'string' },
        max: { type: 'string', default: '0' },
        parallel: { type: 'string' },
        'max-sessions': { type: 'string' },
        model: { type: 'string' },
        'review-model': { type: 'string' },
        'review-harness': { type: 'string' },
        'session-minutes': { type: 'string', default: '90' },
        'merge-minutes': { type: 'string', default: '30' },
        'handover-minutes': { type: 'string' },
        'merge-risk': { type: 'string' },
        'dry-run': { type: 'boolean', default: false },
        'allow-no-required-checks': { type: 'boolean', default: false },
        'trust-authors': { type: 'boolean', default: false },
        'no-retro': { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    // an unknown option or a missing value: one line, no stack trace
    const message = (error as Error).message.split('\n')[0];
    console.error(
      `deliver-loop: ${message}. Options: --milestone, --feature, --issues, --objective, --base, --tracker, --harness, --max, --parallel, --max-sessions, --model, --review-model, --review-harness, --session-minutes, --merge-minutes, --handover-minutes, --merge-risk, --dry-run, --allow-no-required-checks, --trust-authors, --no-retro.`,
    );
    process.exit(1);
  }
})();
const opt = parsed.values;
const output = createOutput();
const { log } = output;
const fail = (message: string, code: number): never => {
  console.error(message);
  process.exit(code);
};

if (
  [opt.milestone, opt.feature, opt.issues, opt.objective].filter((value) => value !== undefined)
    .length !== 1
)
  fail(
    'give exactly one of --milestone <M…>, --feature <nr>, --issues <nr,…> or --objective <owner>/<repo>#<nr>',
    64,
  );
if (opt.milestone === '' || opt.issues === '') fail('--milestone and --issues need a value', 64);
if (opt.objective !== undefined) {
  try {
    parseObjective(opt.objective);
  } catch (error) {
    fail((error as Error).message, 64);
  }
}
if (opt.feature !== undefined && !/^[1-9]\d*$/.test(opt.feature))
  fail('--feature needs the number of an issue', 64);
const whole = (name: 'max' | 'session-minutes' | 'merge-minutes', least: number): number => {
  const value = Number(opt[name]);
  if (!Number.isInteger(value) || value < least)
    fail(`--${name} needs a whole number from ${least}`, 64);
  return value;
};
const MAX = whole('max', 0);
const SESSION_MINUTES = whole('session-minutes', 1);
const MERGE_MINUTES = whole('merge-minutes', 1);
// a stop request: Ctrl-C, or on Windows (no signal reaches the loop from another terminal) a file `stop` in the run folder
const signal = new StopSignal();
const root =
  attempt('git', ['rev-parse', '--show-toplevel']) ??
  fail(
    'deliver-loop: not a git repository. Run it from the repository whose issues it should deliver.',
    1,
  );
const commonDir = path.resolve(root, run('git', ['rev-parse', '--git-common-dir'], root));
const config: {
  deliver?: {
    base?: string;
    harness?: string;
    tracker?: string;
    protectedPaths?: string[];
    handoverMinutes?: number;
    mergeRisk?: unknown;
    parallel?: unknown;
    maxSessions?: unknown;
    review?: unknown;
    retro?: unknown;
  };
} = (() => {
  try {
    return JSON.parse(readFileSync(path.join(root, '.agents/config.json'), 'utf8'));
  } catch {
    // no project config
    return {};
  }
})();
// How long the loop waits for handed-over pull requests when nothing else can start: the flag, then the config, else 120.
const HANDOVER_MINUTES = Number(opt['handover-minutes'] ?? config.deliver?.handoverMinutes ?? 120);
if (!Number.isInteger(HANDOVER_MINUTES) || HANDOVER_MINUTES < 0)
  fail('--handover-minutes (deliver.handoverMinutes) needs a whole number from 0', 64);
// The highest risk level the loop merges: the flag, then the config, else medium. A level above it is handed over.
const MERGE_RISK = String(opt['merge-risk'] ?? config.deliver?.mergeRisk ?? 'medium');
if (!RISK_LEVELS.includes(MERGE_RISK))
  fail(
    `--merge-risk (deliver.mergeRisk) is one of ${RISK_LEVELS.join(', ')}, not "${MERGE_RISK}"`,
    2,
  );
// How many role sessions run at once per repository (and base branch): the flag, then the config, else 1, which
// works one issue after the other.
const PARALLEL = Number(opt.parallel ?? config.deliver?.parallel ?? 1);
if (!Number.isInteger(PARALLEL) || PARALLEL < 1)
  fail('--parallel (deliver.parallel) needs a whole number from 1', 64);
// The cap of an Objective run across its repositories: the flag, then the config, else 3. A run of one repository
// ignores it, also an invalid value.
const MAX_SESSIONS = Number(opt['max-sessions'] ?? config.deliver?.maxSessions ?? 3);
if (opt.objective !== undefined && (!Number.isInteger(MAX_SESSIONS) || MAX_SESSIONS < 1))
  fail('--max-sessions (deliver.maxSessions) needs a whole number from 1', 64);
for (const warning of legacyWarnings) log(warning, 'warn');
const configWarning = unknownConfigKeys(config.deliver);
if (configWarning) log(configWarning, 'warn');
// The base: the flag, then the project config; else release/next for a milestone or a Feature and the default branch otherwise.
// The run has one base for all its issues, so it takes only the default of a PBI from gates/merge-base.mts.
const RELEASE_BASE = mergeBase({ type: 'pbi' }).evidence.base as string;
const BASE: string =
  opt.base ??
  config.deliver?.base ??
  (opt.milestone || opt.feature
    ? RELEASE_BASE
    : (attempt('git', ['ls-remote', '--symref', 'origin', 'HEAD'], root)?.match(
        /^ref: refs\/heads\/(\S+)\s+HEAD/m,
      )?.[1] ?? 'main'));
// The harness is a name (harness.mts builds the command). A command from the project config would let
// a change in the repository decide what the loop runs.
const harnessName = String(opt.harness ?? config.deliver?.harness ?? 'claude');
const harness =
  HARNESSES[harnessName] ??
  fail(`unknown harness "${harnessName}": one of ${Object.keys(HARNESSES).join(', ')}`, 64);
const REVIEW: ReviewSettings = (() => {
  try {
    return reviewSettings({
      flags: { model: opt['review-model'], harness: opt['review-harness'] },
      config: config.deliver?.review,
      implementer: { harnessName },
    });
  } catch (error) {
    return fail((error as Error).message, 64);
  }
})();
// --model, --review-model and deliver.review.model win; else the top-level key `models` decides per role
const MODELS = (() => {
  try {
    return sessionModels({
      layers: readLayers(root),
      harness: harnessName as HarnessName,
      reviewHarness: REVIEW.harnessName as HarnessName,
      model: opt.model,
      reviewModel: REVIEW.model,
    });
  } catch (error) {
    return fail(`models: ${(error as Error).message}`, 64);
  }
})();
for (const warning of MODELS.warnings) log(warning, 'warn');
const RETRO = (() => {
  try {
    return retroSettings({
      disabled: opt['no-retro'],
      config: config.deliver?.retro,
      defaultModel: MODELS.retro.model,
    });
  } catch (error) {
    return fail((error as Error).message, 64);
  }
})();
// Tests only: a command from the environment of the user (JSON array, the prompt is appended).
const HARNESS_OVERRIDE: string[] | undefined = process.env.DELIVER_HARNESS
  ? JSON.parse(process.env.DELIVER_HARNESS)
  : undefined;
// Neither test hook may point into the repository: a merged pull request would then decide what the next run executes.
// Compared as real paths: git names the repository by its real path, a temp directory is often a symlink.
const real = (file: string): string => {
  const full = path.resolve(file);
  try {
    // native: only it expands Windows short names (RUNNER~1)
    return realpathSync.native(full);
  } catch {
    const parent = path.dirname(full);
    return parent === full ? full : path.join(real(parent), path.basename(full));
  }
};
// Another drive (Windows) gives an absolute relative path: outside as well.
const inside = (file: string) => {
  const rel = path.relative(real(root), real(file));
  return !path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`);
};
if (HARNESS_OVERRIDE?.some((part) => path.isAbsolute(part) && inside(part))) {
  fail('DELIVER_HARNESS must not name a file inside the repository', 64);
}
if (process.env.DELIVER_TRACKER_DIR && inside(process.env.DELIVER_TRACKER_DIR)) {
  fail('DELIVER_TRACKER_DIR must not be inside the repository', 64);
}
// Tests only: the directory an Objective run clones `<owner>/<repo>.git` from instead of GitHub.
if (process.env.DELIVER_REPOS_DIR && inside(process.env.DELIVER_REPOS_DIR)) {
  fail('DELIVER_REPOS_DIR must not be inside the repository', 64);
}
// A pull request that changes one of these is never merged by the loop: a person looks at it first
// (the matching rules: protected-paths.mts, which `planner` uses too).
const PROTECTED: string[] = protectedList(config.deliver?.protectedPaths);
// The session acts with a token instead of the login of the user: an installation token of the GitHub App
// (DELIVER_APP_ID and a key file or command), else DELIVER_SESSION_TOKEN (a token limited to this repository). An
// Objective run holds one installation token per repository (`tokenSources`).
const app = (() => {
  try {
    return appSettings();
  } catch (error) {
    return fail(`github app: ${(error as Error).message}`, 64);
  }
})();
const FIXED_TOKEN = app ? undefined : process.env.DELIVER_SESSION_TOKEN;
const TOKEN_SOURCE = app ? 'GitHub App' : FIXED_TOKEN ? 'DELIVER_SESSION_TOKEN' : undefined;
const runId = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${process.pid}`;
// an Objective run has its run folder below the per-user events directory, with one folder per repository
const folders =
  opt.objective === undefined ? undefined : objectiveFolders(eventsDirectory(), commonDir, runId);
const runDir = folders?.run ?? path.join(commonDir, 'deliver', runId);
// OSC 7501 to the controlling terminal (ADR 0007): the events stay the source for displays. The terminal is opened
// with the first report: a dry run reports nothing.
const report = (() => {
  let send: ((status: Report) => void) | undefined;
  return (status: Report) => (send ??= programStatus())(status);
})();
// the run id of the events is a UUIDv7 (agent-events contract); the run folder keeps `runId`. A dry run opens none.
// An Objective run has one run too: its units write through views of this sink (objective-report.mts).
const makeEvents = (): EventSink & { isOpen(): boolean } => {
  let write: Emit | undefined;
  return {
    open() {
      const run = uuid7();
      const dir = eventsDirectory();
      const origin = runOrigin();
      if (dir) pruneRuns(dir, origin.repo);
      write = openEvents(dir, run);
      return { run, dir, origin };
    },
    emit: (type, body, tone) => write?.(type, body, tone),
    isOpen: () => write !== undefined,
  };
};
const events = makeEvents();
const trackerName = opt.tracker ?? config.deliver?.tracker ?? 'github';
const trackerContext = {
  trustAuthors: opt['trust-authors'],
  stopFile: path.join(runDir, 'stop'),
  onStop: signal.request,
  onExhausted: (error: Error) => {
    const body = {
      outcome: 'failed',
      text: firstLine(error).slice(0, 300),
      ...(opt.objective && { deliver: { objective: opt.objective } }),
    };
    events.emit('run.finished', body, 'danger');
    if (events.isOpen() || opt.objective) report(finishReport(body, titleOf(opt), 0));
    log(`run failed: rate limit, ${firstLine(error)}`, 'bad');
    process.exit(1);
  },
  log: (text: string) => log(text, 'warn'),
};
const tracker = await loadTracker(trackerName, {
  ...trackerContext,
  cwd: root,
  base: BASE,
  selection: {
    milestone: opt.milestone,
    feature: opt.feature,
    issues: opt.issues?.split(',').map((nr) => nr.trim()),
  },
}).catch((error) => fail(`tracker: ${firstLine(error)}`, 64));
if (opt.objective !== undefined && opt['dry-run']) {
  // the plan reads only: the Objective's repositories in start order, with the wait reason of every item
  try {
    const source = (repo: string) =>
      app
        ? `${TOKEN_SOURCE}, a token of ${repo}`
        : (TOKEN_SOURCE ?? 'none, the session uses your login');
    for (const line of planObjective(opt.objective, tracker, source)) console.log(line);
  } catch (error) {
    fail(`objective: ${firstLine(error)}`, 1);
  }
  process.exit(0);
}
const options: Omit<RepositoryOptions, 'base' | 'milestone' | 'feature' | 'issues'> = {
  dryRun: opt['dry-run'],
  allowNoRequiredChecks: opt['allow-no-required-checks'],
  model: opt.model,
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
};
if (opt.objective !== undefined) process.exit(await objectiveRun(opt.objective));
const tokenSource = app
  ? makeSource(app, tracker.repo, SESSION_MINUTES * 60_000, appMint)
  : undefined;
const result = await runRepository({
  root,
  options: {
    ...options,
    milestone: opt.milestone,
    feature: opt.feature,
    issues: opt.issues,
    base: BASE,
  },
  tracker,
  token: { source: tokenSource, fixed: FIXED_TOKEN, name: TOKEN_SOURCE },
  runId,
  runDir,
  events,
  status: report,
  signal,
  out: output,
});
process.exit(result.exitCode);

/**
 * The run of an Objective: one frontier over its repositories (objective-run.mts), each in a clone of its own below
 * `<git-common-dir>/deliver/<run>/repos`, each within `--parallel` sessions and all of them within `--max-sessions`. The base of every repository is `--base`, else
 * `release/next`; a unit's lines name its repository.
 */
async function objectiveRun(ref: string): Promise<number> {
  mkdirSync(runDir, { recursive: true });
  mkdirSync(path.join(commonDir, 'deliver'), { recursive: true });
  output.toFile(path.join(commonDir, 'deliver', 'loop.log'));
  signal.watch(path.join(runDir, 'stop'));
  const base = opt.base ?? RELEASE_BASE;
  const slots = new Slots(MAX_SESSIONS);
  const mergeLocks = new MergeLocks();
  // the attention cases of every unit go to deliver-triage, each once in the run; a CI job is re-run once
  const triage = triageRun();
  const sources = app ? tokenSources(app, SESSION_MINUTES * 60_000, appMint) : undefined;
  const reposDir = process.env.DELIVER_REPOS_DIR;
  const checkouts = cloneCheckouts({
    // the clones and the worktrees beside them stay below the git directory of the repository of the run
    runRoot: path.join(commonDir, 'deliver', runId),
    token: async (repo) => {
      const source = sources?.(repo);
      return source ? (await source.current()).token : FIXED_TOKEN;
    },
    ...(reposDir && { url: (repo: string) => path.join(reposDir, `${repo}.git`) }),
  });
  const title = `objective ${ref}`;
  log(
    `run ${runId}: ${title}, base ${base}, up to ${PARALLEL} sessions per repository, ${MAX_SESSIONS} across them`,
    'dim',
  );
  // one file for every repository of the run
  log(`stop file: ${path.join(runDir, 'stop')}`, 'dim');
  const status = objectiveStatus(title, report);
  const stream = objectiveStream(events, ref);
  const runUnit = async (unit: Unit, unitRoot: string) => {
    const slug = unitName(unit).replace(/[^A-Za-z0-9._-]+/g, '-');
    const unitTracker = await loadTracker(trackerName, {
      ...trackerContext,
      cwd: unitRoot,
      repo: unit.repo,
      base,
      selection: {
        ...(unit.milestone ? { milestone: unit.milestone } : { feature: String(unit.feature) }),
        skipDeferred: true,
      },
    });
    const tag = `[${unit.repo}]`;
    const out: Output = {
      say: (line, tone) => output.say(`${tag} ${line}`, tone),
      log: (line, tone) => output.log(`${tag} ${line}`, tone),
      // the lines of every unit go to the log of the run
      toFile: () => {},
    };
    return runRepository({
      root: unitRoot,
      options: {
        ...options,
        base,
        ...(unit.milestone ? { milestone: unit.milestone } : { feature: String(unit.feature) }),
        triage,
      },
      tracker: unitTracker,
      token: { source: sources?.(unit.repo), fixed: FIXED_TOKEN, name: TOKEN_SOURCE },
      runId: `${runId}-${slug}`,
      // the folder of the repository in the run folder: `results.jsonl`, verdicts, a stop file
      runDir: folders!.repository(unit.repo),
      earlierRunDirs: () => folders!.earlier(unit.repo),
      events: stream.unit(unit.repo, unit.milestone ?? `#${unit.feature}`),
      // the end of one unit is not the end of the run
      status: (own) => status.unit(unitName(unit), own),
      signal,
      out,
      mergeLocks,
      slots,
    }).finally(() => status.unit(unitName(unit)));
  };
  const tick = Number(process.env.DELIVER_TICK_MS ?? 1000);
  try {
    const result = await runObjective({
      ref,
      reader: tracker,
      checkouts,
      runUnit,
      pollSeconds: OBJECTIVE_POLL_SECONDS,
      idlePolls: Math.ceil((HANDOVER_MINUTES * 60) / OBJECTIVE_POLL_SECONDS),
      sleep: async (seconds) => {
        for (let second = 0; second < seconds && !signal.stopped; second++)
          await new Promise((done) => setTimeout(done, tick));
      },
      signal,
      say: output.say,
      log,
      events: stream,
      started: {
        host: {
          'jsonl-file.pid': String(process.pid),
          ...(process.env.POIMEN_TERMINAL_ID
            ? { 'poimen.terminal': process.env.POIMEN_TERMINAL_ID }
            : {}),
        },
        agent: { harness: harnessName, model: MODELS.implement('').model },
      },
      onCounts: (counts) => status.counts(counts),
    });
    status.finish(result.exitCode, result.needsYou.length);
    return result.exitCode;
  } catch (error) {
    log(`objective: ${firstLine(error)}`, 'bad');
    stream.emit(
      'run.finished',
      { outcome: 'failed', text: firstLine(error).slice(0, 300) },
      'danger',
    );
    status.finish(1, 0);
    return 1;
  }
}
