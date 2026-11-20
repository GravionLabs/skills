#!/usr/bin/env node
// deliver loop: a fresh agent session per issue, merge its pull request, then the next issue.
// The state is read from the tracker before every issue. The run only remembers what it set aside.
// Tracker: tracker.mts. Progress events: events.mts. Everything else is in this file.
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { appSettings, tokenSource as makeSource } from './app-token.mts';
import { type Emit, openEvents } from './events.mts';
import { programStatus } from './program-status.mts';
import { HARNESSES } from './harness.mts';
import { adoptLegacyEnv, unknownConfigKeys } from './legacy.mts';
import { killTree, launch, promptPath } from './process.mts';
import { progressLine } from './progress-bar.mts';
import { type BaseState, type Gate, type Item, type Pull, loadTracker } from './tracker.mts';

// before anything reads the environment; the warnings are printed once the log exists
const legacyWarnings = adoptLegacyEnv();

const parsed = (() => {
  try {
    return parseArgs({
      options: {
        milestone: { type: 'string' },
        issues: { type: 'string' },
        base: { type: 'string' },
        tracker: { type: 'string' },
        harness: { type: 'string' },
        max: { type: 'string', default: '0' },
        model: { type: 'string' },
        'session-minutes': { type: 'string', default: '90' },
        'merge-minutes': { type: 'string', default: '30' },
        'dry-run': { type: 'boolean', default: false },
        'allow-no-required-checks': { type: 'boolean', default: false },
        'trust-authors': { type: 'boolean', default: false },
      },
    });
  } catch (error) {
    // an unknown option or a missing value: one line, no stack trace
    const message = (error as Error).message.split('\n')[0];
    console.error(
      `deliver-loop: ${message}. Options: --milestone, --issues, --base, --tracker, --harness, --max, --model, --session-minutes, --merge-minutes, --dry-run, --allow-no-required-checks, --trust-authors.`,
    );
    process.exit(1);
  }
})();
const opt = parsed.values;

type Session = {
  exit: number | null;
  turns: number;
  costUsd: number;
  peakContext: number;
  /** The loop killed the session at the session timeout. */
  timedOut?: boolean;
  /** The reason of a final `result: blocked <reason>` line of the session. */
  blocked?: string;
};
type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'dim' | 'bold';

const run = (cmd: string, args: string[], cwd?: string): string =>
  execFileSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
const attempt = (cmd: string, args: string[], cwd?: string): string | undefined => {
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
const firstLine = (error: unknown): string =>
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
let logFile = '';
const say = (line: string, tone?: Tone) => {
  console.log(paint(line, tone, Boolean(process.stdout.isTTY) && !process.env.NO_COLOR));
  if (logFile) appendFileSync(logFile, `${paint(line, tone, !process.env.NO_COLOR)}\n`);
};
const log = (line: string, tone?: Tone) =>
  say(`${new Date().toTimeString().slice(0, 8)} ${line}`, tone);
const fail = (message: string, code: number): never => {
  console.error(message);
  process.exit(code);
};

if (!opt.milestone === !opt.issues)
  fail('give exactly one of --milestone <M…> or --issues <nr,…>', 64);
const whole = (name: 'max' | 'session-minutes' | 'merge-minutes', least: number): number => {
  const value = Number(opt[name]);
  if (!Number.isInteger(value) || value < least)
    fail(`--${name} needs a whole number from ${least}`, 64);
  return value;
};
const MAX = whole('max', 0);
const SESSION_MINUTES = whole('session-minutes', 1);
const MERGE_MINUTES = whole('merge-minutes', 1);
let stopped = false;
let stopSession: (() => void) | undefined;
// a stop request: Ctrl-C, or on Windows (no signal reaches the loop from another terminal) a file `stop` in the run folder
const requestStop = () => {
  stopped = true;
  stopSession?.();
};
const root =
  attempt('git', ['rev-parse', '--show-toplevel']) ??
  fail(
    'deliver-loop: not a git repository. Run it from the repository whose issues it should deliver.',
    1,
  );
const commonDir = path.resolve(root, run('git', ['rev-parse', '--git-common-dir'], root));
let config: {
  deliver?: { base?: string; harness?: string; tracker?: string; protectedPaths?: string[] };
} = {};
try {
  config = JSON.parse(readFileSync(path.join(root, '.agents/config.json'), 'utf8'));
} catch {
  // no project config
}
for (const warning of legacyWarnings) log(warning, 'warn');
const configWarning = unknownConfigKeys(config.deliver);
if (configWarning) log(configWarning, 'warn');
// The base: the flag, then the project config; else release/next for a milestone and the default branch otherwise.
const BASE: string =
  opt.base ??
  config.deliver?.base ??
  (opt.milestone
    ? 'release/next'
    : (attempt('git', ['ls-remote', '--symref', 'origin', 'HEAD'], root)?.match(
        /^ref: refs\/heads\/(\S+)\s+HEAD/m,
      )?.[1] ?? 'main'));
// The harness is a name (harness.mts builds the command). A command from the project config would let
// a change in the repository decide what the loop runs.
const harnessName = String(opt.harness ?? config.deliver?.harness ?? 'claude');
const harness =
  HARNESSES[harnessName] ??
  fail(`unknown harness "${harnessName}": one of ${Object.keys(HARNESSES).join(', ')}`, 64);
const MODEL = opt.model ?? harness.defaultModel;
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
// A pull request that changes one of these is never merged by the loop: a person looks at it first.
// `dir/` is a directory at the root, anything else a file name anywhere. deliver.protectedPaths replaces the list.
// The default list is `protected-paths.json` next to the skill (`planner` reads the same file).
const PROTECTED: string[] =
  config.deliver?.protectedPaths ??
  JSON.parse(
    readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../protected-paths.json'),
      'utf8',
    ),
  );
// Without regard to case (a checkout on macOS or Windows writes `.Claude/` into `.claude/`), and a file named
// like a protected directory counts too (a symlink `.claude`).
const protectedHits = (files: string[]): string[] =>
  files.filter((file) => {
    const name = file.toLowerCase();
    return PROTECTED.some((entry) => {
      const guarded = entry.toLowerCase();
      return guarded.endsWith('/')
        ? name.startsWith(guarded) || name === guarded.slice(0, -1)
        : name === guarded || path.posix.basename(name) === guarded;
    });
  });
/** Why the loop does not merge the pull request as it is now, else nothing. A person decides then, no repair session. */
const HANDS_OFF = ', merge it yourself';
const GUARD_READS = 3;
async function guard(pull: Pull): Promise<string | undefined> {
  let hits: string[] = [];
  for (let read = 1; ; read++) {
    try {
      hits = protectedHits(tracker.changedFiles(pull));
      break;
    } catch (error) {
      // a read that fails once (server load, rate limit) is asked again, as the gate is
      if (read < GUARD_READS && !stopped) {
        for (let second = 0; second < 5 && !stopped; second++) await sleep(1);
        continue;
      }
      // unknown is not safe: a person looks
      return `could not read the changed files (${firstLine(error)})${HANDS_OFF}`;
    }
  }
  if (hits.length === 0) return undefined;
  return `changes protected paths (${hits.slice(0, 3).join(', ')}${hits.length > 3 ? ', …' : ''})${HANDS_OFF}`;
}
/** The reason of a `result: blocked` session is kept next to the reason of the loop. */
function withBlocked(reason: string, session: Session): string {
  if (!session.blocked) return reason;
  const note = `session: blocked ${session.blocked}`;
  return reason.endsWith(HANDS_OFF)
    ? `${reason.slice(0, -HANDS_OFF.length)} (${note})${HANDS_OFF}`
    : `${reason} (${note})`;
}
// The session acts with a token instead of the login of the user: an installation token of the GitHub App
// (DELIVER_APP_ID and a key file or command), else DELIVER_SESSION_TOKEN (a token limited to this repository).
let app: ReturnType<typeof appSettings>;
try {
  app = appSettings();
} catch (error) {
  fail(`github app: ${(error as Error).message}`, 64);
}
const FIXED_TOKEN = app ? undefined : process.env.DELIVER_SESSION_TOKEN;
const TOKEN_SOURCE = app ? 'GitHub App' : FIXED_TOKEN ? 'DELIVER_SESSION_TOKEN' : undefined;
const runId = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${process.pid}`;
const runDir = path.join(commonDir, 'deliver', runId);
const tracker = await loadTracker(opt.tracker ?? config.deliver?.tracker ?? 'github', {
  cwd: root,
  base: BASE,
  selection: { milestone: opt.milestone, issues: opt.issues?.split(',').map((nr) => nr.trim()) },
  trustAuthors: opt['trust-authors'],
  stopFile: path.join(runDir, 'stop'),
  onStop: requestStop,
  onExhausted: (error) => {
    emit('run.finished', { outcome: 'failed', text: firstLine(error).slice(0, 300) }, 'danger');
    log(`run failed: rate limit, ${firstLine(error)}`, 'bad');
    process.exit(1);
  },
  log: (text) => log(text, 'warn'),
}).catch((error) => fail(`tracker: ${firstLine(error)}`, 64));
const tokenSource = app ? makeSource(app, tracker.repo, SESSION_MINUTES * 60_000) : undefined;
let emit: Emit = () => {};

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
    return /^result: (pr \S+|needs-decision|blocked\b.*)$/.test(last.trim());
  } catch {
    return false;
  }
}

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

const RISK_LEVELS = ['low', 'medium', 'high'];
const risks = new Map<number, string>();
/** The implementer result the session writes (`risk.level`); the session never reports anything else to the loop. */
const resultFile = (item: Item) => path.join(runDir, `${item.id}.result.json`);
function riskOf(item: Item): string | undefined {
  try {
    const level = JSON.parse(readFileSync(resultFile(item), 'utf8'))?.risk?.level;
    return RISK_LEVELS.includes(level) ? level : undefined;
  } catch {
    return undefined;
  }
}

async function startSession(item: Item, cwd: string, file: string): Promise<Session> {
  // the session works from this text, not from what the tracker shows when it runs
  const issueFile = path.join(runDir, `${item.id}.issue.md`);
  writeFileSync(issueFile, `# ${item.title}\n\n${item.url}\n\n${item.body}\n`);
  const prompt = `/deliver ${item.id} --base ${BASE} --issue-file ${promptPath(issueFile)}`;
  const argv = HARNESS_OVERRIDE
    ? [...HARNESS_OVERRIDE, prompt]
    : harness.command({ prompt, model: opt.model });
  // an app token is renewed when less than the session timeout is left; the merge keeps the login of the user
  const sessionToken = tokenSource ? await tokenSource.current() : undefined;
  if (sessionToken?.renewed) log('app token minted for this session', 'dim');
  const token = sessionToken?.token ?? FIXED_TOKEN;
  const env: NodeJS.ProcessEnv = {
    // -p stops subagents 10 minutes after the last turn unless the ceiling is off
    CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS: '0',
    ...process.env,
    DELIVER_RUN: runId,
    DELIVER_RESULT_FILE: resultFile(item),
    ...(token ? tracker.sessionEnv(token) : {}),
  };
  // the session gets the token, never the way to mint one
  for (const name of [
    'DELIVER_SESSION_TOKEN',
    'DELIVER_APP_ID',
    'DELIVER_APP_KEY_FILE',
    'DELIVER_APP_KEY_COMMAND',
    'DELIVER_APP_API_URL',
  ])
    delete env[name];
  // a result of an earlier session is not the result of this one
  rmSync(resultFile(item), { force: true });
  const session: Session = { exit: null, turns: 0, costUsd: 0, peakContext: 0 };
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
    stopSession = stop;
    // a session that scheduled a wakeup prints its final result and then stays alive until the wakeup fires:
    // once the final `result:` line is in and nothing follows for a moment, the loop ends the process itself
    let grace: NodeJS.Timeout | undefined;
    let finished = false;
    createInterface({ input: child.stdout! }).on('line', (line) => {
      out.write(`${line}\n`);
      clearTimeout(grace);
      if (finishedResult(line)) {
        grace = setTimeout(() => {
          finished = true;
          log(`#${item.id} session printed its result and stays alive: ended by the loop`, 'dim');
          killTree(child);
        }, RESULT_GRACE_MS);
      }
      if (harness.claudeStream) render(line, session);
      else {
        // no stream format: the plain lines of the harness, without color codes and empty lines
        const plain = line.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '').trimEnd();
        if (plain) {
          noteBlocked(plain, session);
          say(`  ${plain}`);
        }
      }
    });
    child.on('error', (error) => log(`#${item.id} session: ${error.message}`, 'bad'));
    child.on('close', (code) => {
      clearTimeout(timer);
      clearTimeout(grace);
      if (stopSession === stop) stopSession = undefined;
      out.end();
      session.exit = finished ? 0 : code;
      done(session);
    });
  });
}

const CLOSED = 'pull request closed';

// Harness failures (exit ≠ 0, no pull request, no timeout kill): wait 5, 15, 60 minutes, the third in a row ends the run.
const HARNESS_WAITS_MINUTES = [5, 15, 60];
const HARNESS_FAILED = 'harness failed';
let harnessFailures = 0;
let harnessDead: { count: number; exit: number | null } | undefined;
// a session timeout gets one more session per PBI and run, the second sets the PBI aside
const timeouts = new Map<number, number>();

/** Starts sessions for the item until one ends normally. Returns a reason when the item is to be set aside. */
async function runSession(
  item: Item,
  worktree: string,
  sessions: Session[],
): Promise<{ session: Session; reason?: string }> {
  for (;;) {
    const session = await startSession(
      item,
      worktree,
      path.join(runDir, `${item.id}-${sessions.length + 1}.jsonl`),
    );
    sessions.push(session);
    if (stopped) return { session };
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
    // a pull request means the session did its work: the normal rules for a failed session apply
    if (tracker.pullOf(item)) return { session };
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
    for (let half = 0; half < minutes * 2 && !stopped; half++) await sleep(30);
    if (stopped) return { session };
  }
}

/**
 * Tracker calls block the event loop: a stop request that came in meanwhile is only read in the poll phase.
 * A timer runs before the poll phase, and from a poll callback the check phase follows without a new poll:
 * two setImmediate turns always include one full poll.
 */
async function seeStop(): Promise<void> {
  await new Promise((turn) => setImmediate(turn));
  await new Promise((turn) => setImmediate(turn));
}

/** Waits for the gate and merges. Returns nothing when merged, else the reason. */
async function merge(pull: Pull): Promise<string | undefined> {
  const start = Date.now();
  let problem = '';
  while (!stopped) {
    let gate: Gate;
    try {
      gate = tracker.gate(pull);
    } catch (error) {
      // a tracker call that fails once (network, rate limit) is not a verdict on the pull request
      problem = `tracker error: ${firstLine(error)}`;
      gate = { state: 'pending', reported: false };
    }
    if (gate.state === 'merged') return undefined;
    if (gate.state === 'closed') return CLOSED;
    if (gate.state === 'conflict') return gate.detail;
    if (gate.state === 'red') return `red: ${gate.detail}`;
    // checks register a moment after the pull request opens: nothing reported is not green yet
    if (gate.state === 'ready' && (gate.reported || Date.now() - start > 90_000)) {
      await seeStop();
      if (stopped) break;
      // the files of the commit that is merged, not of the one the session left: a later push is checked too.
      // The merge names gate.head, so a push after this read is refused by the tracker.
      const handsOff = await guard(pull);
      if (handsOff) return handsOff;
      // the read of the files blocks too: a stop request that came in during it must be seen before the merge
      await seeStop();
      if (stopped) break;
      try {
        tracker.merge(pull, gate.head);
        return undefined;
      } catch (error) {
        problem = `merge refused: ${(error as Error).message}`;
      }
    }
    if (Date.now() - start > MERGE_MINUTES * 60_000) return problem || 'checks did not finish';
    for (let second = 0; second < 30 && !stopped; second++) await sleep(1);
  }
  return 'stopped';
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
  // a pull request of an earlier run that changes a protected path is handed over before a session is paid for;
  // a failed read is no verdict here, the guard after the session asks again
  const earlier = tracker.pullOf(item);
  if (earlier) {
    const early = await guard(earlier);
    if (early?.startsWith('changes protected paths')) {
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
  }
  for (let round = 1; round <= 2; round++) {
    const ran = await runSession(item, worktree, sessions);
    const session = ran.session;
    reason = undefined;
    pull = tracker.pullOf(item);
    const settle = () => {
      if (reason) reason = withBlocked(reason, session);
    };
    // a stopped or failed session never leads to a merge, also when a pull request is open
    if (stopped) reason = 'stopped';
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
    if (reason || !pull) {
      settle();
      break;
    }
    reason = await guard(pull);
    if (reason) {
      settle();
      break;
    }
    if (round === 1) {
      emit('step.finished', {
        task,
        step: { name: 'pr', text: 'pull request opened, waits for checks' },
        links: [{ rel: 'pull-request', url: pull.url, title: pull.title }],
      });
    }
    log(`#${item.id} pr: ${pull.url}, waits for checks`, 'info');
    reason = await merge(pull);
    // a person closed it or has to look at it: no repair session
    if (!reason || reason === 'stopped' || reason === CLOSED || reason.endsWith(HANDS_OFF)) break;
    log(`#${item.id} ${reason}${round === 1 ? ', one repair session' : ''}`, 'warn');
    if (round === 1)
      emit('step.finished', { task, step: { name: 'repair', text: reason } }, 'warning');
  }
  if (pull && !reason) {
    // merged: the worktree and the branches can go
    cleanup(item, pull);
  } else {
    // not merged: the worktree may hold work that is not pushed
    log(`#${item.id} worktree kept: ${worktree}`, 'warn');
  }
  const risk = riskOf(item);
  if (risk) risks.set(item.id, risk);
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
      sessions,
    })}\n`,
  );
  return { reason, pull };
}

let cutNote = '';
const baseExists = () =>
  attempt('git', ['ls-remote', '--exit-code', '--heads', 'origin', BASE], root) !== undefined;
if (!baseExists()) {
  // after every release the merge deletes release/next: cut it again from the default branch, as github-release cut does
  if (BASE !== 'release/next') fail(`${BASE} is missing on origin`, 3);
  if (opt['dry-run']) {
    console.log(`${BASE} is missing on origin, the loop cuts it from the default branch`);
  } else {
    try {
      const target = tracker.defaultBranch();
      run('git', ['fetch', '--quiet', 'origin', target], root);
      run('git', ['push', '--quiet', 'origin', `origin/${target}:refs/heads/${BASE}`], root);
      cutNote = `${BASE} was missing on origin: cut from ${target}`;
    } catch (error) {
      fail(`${BASE} is missing on origin and could not be cut: ${firstLine(error)}`, 3);
    }
  }
}

const required = tracker.requiredChecks();
if (required.length === 0 && !opt['allow-no-required-checks']) {
  fail(
    `${BASE} requires no checks in ${tracker.repo}, so nothing guards the merge: add a ruleset with required checks, or pass --allow-no-required-checks`,
    3,
  );
}

if (opt['dry-run']) {
  try {
    for (const item of tracker.items()) {
      console.log(`#${item.id} ${tracker.waitReason(item) ?? 'ready'}: ${item.title}`);
    }
  } catch (error) {
    fail(`tracker: ${firstLine(error)}`, 64);
  }
  console.log(
    `harness: ${harnessName} (${harness.command({ prompt: '/deliver <nr> …', model: opt.model }).join(' ')})`,
  );
  console.log(`tracker: ${tracker.name}, base: ${BASE}`);
  console.log(`required checks: ${required.join(', ') || 'none'}`);
  console.log(`session token: ${TOKEN_SOURCE ?? 'none, the session uses your login'}`);
  console.log(`protected paths: ${PROTECTED.join(' ')}`);
  process.exit(0);
}

mkdirSync(runDir, { recursive: true });
logFile = path.join(path.dirname(runDir), 'loop.log');
const writeEvent = openEvents(
  process.env.AGENT_EVENTS_DIR ?? path.join(commonDir, '.agents', 'events'),
  runId,
);
// OSC 7501 to the controlling terminal (ADR 0007): the events stay the source for displays
const report = programStatus();
const statusTitle = opt.milestone ?? `issues ${opt.issues}`;
let blockedShown = false;
emit = (type, body, tone) => {
  writeEvent(type, body, tone);
  if (type === 'run.started') {
    report({ state: 'working', title: statusTitle });
  } else if (type === 'attention' && body?.needsYou) {
    blockedShown = true;
    report({
      state: 'blocked',
      kind: 'question',
      title: statusTitle,
      msg: String(body.text ?? ''),
    });
  } else if (type === 'task.started' && blockedShown) {
    blockedShown = false;
    report({ state: 'working', title: statusTitle });
  } else if (type === 'run.finished') {
    const outcome = body?.outcome;
    report(
      outcome === 'cancelled'
        ? { state: 'idle', title: statusTitle }
        : {
            state: outcome === 'succeeded' ? 'done' : 'error',
            title: statusTitle,
            msg: String(body?.text ?? ''),
          },
    );
  }
};
log(`run ${runId} in ${tracker.repo}, results: ${path.join(runDir, 'results.jsonl')}`, 'dim');
if (cutNote) log(cutNote, 'info');
if (!TOKEN_SOURCE) {
  log(
    'the session uses your own login: set DELIVER_APP_ID with DELIVER_APP_KEY_FILE or DELIVER_APP_KEY_COMMAND (GitHub App), or DELIVER_SESSION_TOKEN',
    'warn',
  );
}
emit('run.started', {
  profiles: [],
  host: {
    'jsonl-file.pid': String(process.pid),
    ...(process.env.POIMEN_TERMINAL_ID
      ? { 'poimen.terminal': process.env.POIMEN_TERMINAL_ID }
      : {}),
  },
  agent: { harness: harnessName, model: MODEL },
  subject: tracker.subject(),
});

const aside = new Map<number, string>();
// handed over by rule (the guard): a person merges the pull request, it is no failure
const handedOver = new Map<number, string>();
const merged: string[] = [];
let waiting: string[] = [];
let total = 0;
process.on('SIGINT', requestStop);
process.on('SIGBREAK', requestStop);
setInterval(() => {
  if (!stopped && existsSync(path.join(runDir, 'stop'))) requestStop();
}, 500).unref();

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
    if (!state || state.state !== 'pending' || stopped) return state;
    if (Date.now() - start > MERGE_MINUTES * 60_000) return state;
    for (let second = 0; second < 30 && !stopped; second++) await sleep(1);
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
    for (let second = 0; second < 30 && !stopped; second++) await sleep(1);
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

try {
  for (let count = 0; !stopped && (MAX === 0 || count < MAX); count++) {
    // an issue closes a moment after its merge: do not pick it again
    const open = tracker
      .items()
      .filter((item) => !merged.some((line) => line.startsWith(`#${item.id} `)));
    if (count === 0) {
      total = open.length;
      emit('progress', { done: 0, total, label: 'PBIs' });
    }
    waiting = [];
    let next: Item | undefined = await checkBase();
    if (baseBlocked) break;
    if (next) {
      // the Bug of a red base goes first, as a normal iteration (it may not be in the selection)
      const repair = next;
      next = open.find((item) => item.id === repair.id) ?? repair;
    }
    for (const item of next ? [] : open) {
      if (aside.has(item.id) || handedOver.has(item.id)) continue;
      const reason = tracker.waitReason(item);
      if (reason) waiting.push(`#${item.id} ${reason}`);
      else if (!next) next = item;
    }
    if (!next) break;
    log(`#${next.id} start: ${next.title} (${open.length} open)`, 'info');
    // x: the issues finished or set aside so far, plus this one; the log file is read at a fixed width
    const begun = merged.length + aside.size + handedOver.size + 1;
    log(
      progressLine(begun, total, process.stdout.isTTY ? (process.stdout.columns ?? 80) : 80),
      'info',
    );
    emit('task.started', { task: `issue-${next.id}`, subject: tracker.itemSubject(next) });
    // a failing tracker or git call sets the issue aside, it does not end the run
    const { reason, pull } = await deliver(next).catch(
      (error): { reason?: string; pull?: Pull } => ({ reason: `error: ${firstLine(error)}` }),
    );
    if (!reason) {
      merged.push(
        `#${next.id} ${pull?.url}${risks.has(next.id) ? ` (risk ${risks.get(next.id)})` : ''}`,
      );
      log(`#${next.id} merged: ${pull?.url}`, 'ok');
      emit(
        'task.finished',
        { task: `issue-${next.id}`, outcome: 'succeeded', text: 'merged' },
        'success',
      );
      // the tracker closes the issue a moment after the merge; until then it still blocks its dependents
      for (let second = 0; second < 120 && !stopped; second += 5) {
        let closed = false;
        try {
          closed = !tracker.items().some((item) => item.id === next.id);
        } catch {
          // asked again
        }
        if (closed) break;
        for (let wait = 0; wait < 5 && !stopped; wait++) await sleep(1);
      }
    } else if (reason === 'stopped') {
      log(`#${next.id} stopped: not merged${pull ? `, ${pull.url}` : ''}`, 'warn');
      emit('task.finished', { task: `issue-${next.id}`, outcome: 'cancelled', text: 'stopped' });
    } else {
      const planned = reason.endsWith(HANDS_OFF);
      const why = planned ? reason.slice(0, -HANDS_OFF.length) : reason;
      (planned ? handedOver : aside).set(next.id, `${why}${pull ? `, ${pull.url}` : ''}`);
      log(
        planned
          ? `#${next.id} handed over: ${why}, merge it yourself`
          : `#${next.id} set aside: ${reason}`,
        planned ? 'warn' : 'bad',
      );
      emit(
        'task.finished',
        { task: `issue-${next.id}`, outcome: 'skipped', text: reason },
        'warning',
      );
      // after the task: an attention of a finished task would close with it
      emit(
        'attention',
        {
          id: `aside-${next.id}`,
          reason: 'set-aside',
          text: `#${next.id} set aside: ${reason}`,
          needsYou: true,
          links: [{ rel: pull ? 'pull-request' : 'issue', url: pull?.url ?? next.url }],
        },
        'warning',
      );
    }
    emit('progress', { done: merged.length, total, label: 'PBIs' });
    if (harnessDead) break;
  }
} catch (error) {
  emit('run.finished', { outcome: 'failed', text: firstLine(error).slice(0, 300) }, 'danger');
  log(`run failed: ${firstLine(error)}`, 'bad');
  process.exit(1);
}

// A fully delivered milestone ends with the release pull request, which a person merges.
let needsYou: string[] = [];
let releaseError = '';
const complete =
  Boolean(opt.milestone) &&
  !stopped &&
  aside.size === 0 &&
  handedOver.size === 0 &&
  !baseBlocked &&
  waiting.length === 0;
if (complete) {
  try {
    if (tracker.items().length === 0 && merged.length === 0 && tracker.releaseCommits() === 0) {
      log(
        `milestone ${opt.milestone} has no open issue and ${BASE} has no commit beyond ${tracker.defaultBranch()}, nothing to deliver`,
        'info',
      );
    } else if (tracker.items().length === 0) {
      const release = tracker.ensureReleasePull();
      log(`release pull request: ${release.url} (never merged by the loop)`, 'info');
      emit('step.finished', {
        task: 'release',
        step: { name: 'release-pr', text: 'release pull request' },
        links: [{ rel: 'pull-request', url: release.url, title: release.title }],
      });
      for (const test of tracker.releaseTests()) {
        needsYou.push(`#${test.id} ${test.title}`);
        emit(
          'attention',
          {
            id: `release-test-${test.id}`,
            reason: 'release-test',
            text: `#${test.id} release test is open: a person tests the release candidate`,
            needsYou: true,
            links: [{ rel: 'issue', url: test.url }],
          },
          'warning',
        );
      }
    }
  } catch (error) {
    needsYou = [];
    log(`release pull request: ${firstLine(error)}`, 'bad');
    releaseError = firstLine(error);
  }
}

// an issue of level high is listed first: a person looks at it before the rest
const highRisk = [...risks]
  .filter(([, level]) => level === 'high')
  .map(([nr]) => `#${nr} risk high`);
needsYou = [...highRisk, ...[...handedOver].map(([nr, why]) => `#${nr} ${why}`), ...needsYou];
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
if (releaseError) say(`release pull request failed: ${releaseError}`, 'bad');
say(
  `needs you (${needsYou.length}):${needsYou.map((line) => `\n  ${line}`).join('')}`,
  needsYou.length ? 'warn' : undefined,
);
if (baseBlocked) {
  say(`blocked: ${baseBlocked}`, 'bad');
  emit(
    'attention',
    {
      id: 'base-red',
      reason: 'base-red',
      text: `blocked: ${baseBlocked}`,
      needsYou: true,
      links: repairBug ? [{ rel: 'issue', url: repairBug.url }] : [],
    },
    'warning',
  );
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
const clean =
  !baseBlocked &&
  !releaseError &&
  aside.size === 0 &&
  handedOver.size === 0 &&
  waiting.length === 0;
// done, blocked (a red base, an issue set aside, an error) or waiting for a handed-over pull request
const status = harnessDead
  ? 'failed'
  : clean
    ? 'done'
    : !baseBlocked && !releaseError && aside.size === 0 && handedOver.size > 0
      ? 'waiting-for-handed-over'
      : 'blocked';
if (!stopped) {
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
  })}\n`,
);
// An incomplete run (issues set aside or waiting) is no success: the agent-events format has no
// other outcome for it than `failed`; the counts are in the text.
emit(
  'run.finished',
  {
    outcome: stopped ? 'cancelled' : clean ? 'succeeded' : 'failed',
    ...(stopped || clean ? {} : { reason: 'incomplete' }),
    text: `${status}: merged ${merged.length}, set aside ${aside.size}, waiting ${waiting.length}${needsYou.length ? `, needs you ${needsYou.length}` : ''}`,
  },
  stopped ? 'neutral' : clean ? 'success' : 'warning',
);
process.exit(
  stopped
    ? 130
    : clean
      ? 0
      : status === 'failed'
        ? 5
        : status === 'waiting-for-handed-over'
          ? 3
          : 2,
);
