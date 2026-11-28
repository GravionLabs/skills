// Shared by the tests of the deliver loop: starts deliver-loop.mts as its own process, with the fake tracker and the
// fake harness of this directory, in a real git repository.
import { execFileSync, spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll } from 'vitest';

export const skill = path.resolve(__dirname, '../../../../skills/delivery/deliver');
export const loopScript = path.join(skill, 'scripts/deliver-loop.mts');
const helpers = __dirname;

export type Result = {
  issue: number;
  outcome: string;
  reason?: string;
  risk?: string;
  sessions?: { role?: string; model: string; tier: string }[];
};

export type Scenario = {
  /** The repositories of an Objective, as `tracker/fake.mts` reads them (`--objective` runs). */
  repositories?: Record<string, unknown>;
  items: {
    id: number;
    title: string;
    body?: string;
    blockedBy?: number[];
    feature?: number;
  }[];
  gates?: unknown[];
  files?: string[];
  filesLater?: string[];
  required?: string[];
  needsDecision?: boolean;
  gateBlockMs?: number;
  stopInGate?: boolean;
  stopInChangedFiles?: boolean;
  exits?: number[];
  noPull?: boolean;
  risks?: Record<number, string>;
  filesFailures?: number;
  packageJson?: { base?: string; head?: string };
  cargoToml?: { base?: string; head?: string };
  pnpmWorkspace?: { base?: string; head?: string };
  pyproject?: { base?: string; head?: string };
  goMod?: { base?: string; head?: string };
  packagesProps?: { base?: string; head?: string };
  blocked?: string;
  earlierPull?: boolean;
  twoPulls?: number[];
  lingers?: boolean;
  hangs?: boolean;
  /** The sessions that never end: `<id>` (implementer) or `review:<id>`. */
  hangsOn?: string[];
  plan?: { exit?: number; noPull?: boolean; hangs?: boolean }[];
  closeAfterCalls?: number;
  releaseTests?: number[];
  releaseCommits?: number;
  base?: string[];
  mergedBefore?: number[];
  mergedDuring?: number[];
  verdicts?: ('approve' | 'changes' | 'invalid' | 'none' | 'fail')[];
  /** The summary of the finding of a `changes` verdict, which then has no unmet criterion. */
  summary?: string;
  retroFeature?: boolean;
  features?: Record<number, { title: string; body: string }>;
  retro?: 'post' | 'fail' | 'none' | 'hang';
  /** Only the first implementer session writes the risk level. */
  riskOnce?: boolean;
  /** Every implementer and review session of the fake harness works this long. */
  sessionMs?: number;
  /** Repositories of an Objective run whose release pull request releases its milestone at once. */
  releaseOnPull?: string[];
};
/** A session of the fake harness: its process and when it started and ended (ms since the epoch). */
export type Span = { id: number; pid: number; at: number; end: number; review: boolean };
export type Outcome = {
  /** The case directory: `resume` of a further run. */
  dir: string;
  status: number | null;
  stdout: string;
  stderr: string;
  /** The selection the loop handed to the tracker. */
  selection?: { milestone?: string; feature?: string; issues?: string[] };
  merges: { pull: number; head: string }[];
  /** The stages the loop wrote, in order; `null` removes the label. */
  stages: { id: number; stage: string | null }[];
  releasePulls: number;
  /** The comments the loop asked the tracker to post on an issue. */
  comments: { id: number; marker: string; body: string }[];
  calls: string[];
  sessions: {
    id: number;
    prompt: string;
    run: string | null;
    ghToken: string | null;
    hasSessionTokenVariable: boolean;
  }[];
  retros: { prompt: string; releasePulls: number }[];
  reviews: {
    id: number;
    prompt: string;
    cwd: string;
    hasResultFileVariable: boolean;
    hasStyleguide: boolean;
  }[];
  results: Result[];
  /** Every implementer and review session, in the order they started. */
  spans: Span[];
  final?: Record<string, unknown>;
  events: { type: string; outcome?: string; reason?: string; needsYou?: boolean }[];
  /** The events file of the run. */
  eventsFile: string;
  log: string;
};

export let root: string;
export let repo: string;
let count = 0;

export const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
export const lines = <T>(file: string): T[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

/** Runs the loop for one scenario. `whenStdout` is called with the output so far (the stop case sends a signal). */
export function loop(
  scenario: Scenario,
  options: {
    args?: string[];
    milestone?: boolean;
    /** `--feature <nr>` instead of `--issues`. */
    feature?: number;
    /** Sessions at once; default 1 (one issue after the other), `default`: no flag, the config or the loop decides. */
    parallel?: number | 'default';
    env?: Record<string, string>;
    /** The case directory of an earlier run: this run finds its pull requests, stages and merges. */
    resume?: string;
    whenStdout?: (out: string, stop: () => void) => void;
  } = {},
): Promise<Outcome> {
  count += 1;
  const dir = options.resume ?? path.join(root, `case-${count}`);
  if (!options.resume) mkdirSync(dir);
  writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(scenario));
  if (scenario.earlierPull)
    for (const item of scenario.items) writeFileSync(path.join(dir, `pr-${item.id}`), '');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    FAKE_DIR: dir,
    // `models` is also read from the home directory: never the one of the user
    HOME: dir,
    USERPROFILE: dir,
    AGENT_EVENTS_DIR: path.join(dir, 'events'),
    DELIVER_TRACKER_DIR: path.join(helpers, 'tracker'),
    DELIVER_HARNESS: JSON.stringify(['node', path.join(helpers, 'fake-harness.mjs'), dir]),
    DELIVER_TICK_MS: '1',
    GH_TOKEN: 'login-token',
    ...options.env,
  };
  if (!options.env?.['DELIVER_SESSION_TOKEN']) delete env['DELIVER_SESSION_TOKEN'];
  // the user's own (old or new) variables must not leak into the loop under test
  delete env['DELIVER_MIN_SESSION_TOKEN'];
  const issues = scenario.items.map((item) => item.id).join(',');
  return new Promise((done) => {
    const child = spawn(
      'node',
      [
        loopScript,
        '--tracker',
        'fake',
        // a test with `--objective` in its args names the selection itself
        ...(options.args?.includes('--objective')
          ? []
          : options.milestone
            ? ['--milestone', 'M001']
            : options.feature
              ? ['--feature', String(options.feature)]
              : ['--issues', issues]),
        // no wait for handed-over pull requests unless a test asks for one
        ...(options.args?.includes('--handover-minutes') ? [] : ['--handover-minutes', '0']),
        // the cases are written for one issue after the other unless a test asks for parallel sessions
        ...(options.parallel === 'default' ? [] : ['--parallel', String(options.parallel ?? 1)]),
        ...(options.args ?? []),
      ],
      { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    let signalled = false;
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      options.whenStdout?.(stdout, () => {
        if (!signalled) {
          // Windows cannot deliver SIGINT to a process: the loop also stops on a file `stop` in its run folder
          const results = /results: (\S+)/.exec(stdout)?.[1];
          if (process.platform === 'win32' && results)
            writeFileSync(path.join(path.dirname(results), 'stop'), '');
          else child.kill('SIGINT');
        }
        signalled = true;
      });
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      const results = /results: (\S+)/.exec(stdout)?.[1];
      const events = path.join(dir, 'events');
      // an Objective run also has its run folder (a directory) there
      const eventsFile = path.join(
        events,
        (existsSync(events) ? readdirSync(events) : []).find((name) => name.endsWith('.jsonl')) ??
          'none.jsonl',
      );
      done({
        dir,
        status,
        stdout,
        stderr,
        selection: existsSync(path.join(dir, 'selection.json'))
          ? JSON.parse(readFileSync(path.join(dir, 'selection.json'), 'utf8'))
          : undefined,
        merges: lines<{ call: string; pull: number; head: string }>(
          path.join(dir, 'calls.jsonl'),
        ).filter((call) => call.call === 'merge'),
        releasePulls: lines<{ call: string }>(path.join(dir, 'calls.jsonl')).filter(
          (call) => call.call === 'releasePull',
        ).length,
        calls: lines<{ call: string }>(path.join(dir, 'calls.jsonl')).map((call) => call.call),
        stages: lines(path.join(dir, 'stages.jsonl')),
        comments: lines(path.join(dir, 'comments.jsonl')),
        sessions: lines(path.join(dir, 'sessions.jsonl')),
        reviews: lines(path.join(dir, 'reviews.jsonl')),
        retros: lines(path.join(dir, 'retros.jsonl')),
        spans: spansOf(dir),
        results: results
          ? lines<Result | { issue?: undefined }>(results).filter(
              (r): r is Result => r.issue !== undefined,
            )
          : [],
        final: results ? lines<Record<string, unknown>>(results).find((r) => r.run) : undefined,
        eventsFile,
        events: existsSync(eventsFile) ? lines(eventsFile) : [],
        // below the git directory, also for an Objective run, whose run folder is in the events directory
        log: results ? readFileSync(path.join(repo, '.git', 'deliver', 'loop.log'), 'utf8') : '',
      });
    });
  });
}

/** The sessions of a case with their end, by start time. */
function spansOf(dir: string): Span[] {
  const ends = new Map(
    lines<{ pid: number; at: number }>(path.join(dir, 'ends.jsonl')).map((e) => [e.pid, e.at]),
  );
  const of = (file: string, review: boolean) =>
    lines<{ id: number; pid: number; at: number }>(path.join(dir, file)).map(({ id, pid, at }) => ({
      id,
      pid,
      at,
      end: ends.get(pid) ?? Number.POSITIVE_INFINITY,
      review,
    }));
  return [...of('sessions.jsonl', false), ...of('reviews.jsonl', true)].sort((a, b) => a.at - b.at);
}

export const READY = { state: 'ready', reported: true, head: 'abc123' };
export const RED = { state: 'red', detail: 'ci' };

/** Builds the fixture repository of a test file and removes it afterwards. */
export function fixture(): void {
  beforeAll(() => {
    root = mkdtempSync(path.join(tmpdir(), 'deliver-'));
    const origin = path.join(root, 'origin.git');
    repo = path.join(root, 'repo');
    execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch', 'main', origin]);
    execFileSync('git', ['init', '--quiet', '--initial-branch', 'main', repo]);
    writeFileSync(path.join(repo, 'README.md'), 'fixture\n');
    git(repo, 'add', 'README.md');
    git(repo, 'commit', '--quiet', '-m', 'chore: fixture');
    git(repo, 'remote', 'add', 'origin', origin);
    git(repo, 'push', '--quiet', 'origin', 'main', 'main:release/next');
    // the head of every pull request of the fake tracker
    git(repo, 'tag', 'abc123');
  });

  afterAll(() => {
    rmSync(root, { recursive: true, force: true });
  });
}
