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
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { parseArgs } from 'node:util';
import { appSettings, tokenSource as makeSource } from './app-token.mts';
import { type Emit, openEvents } from './events.mts';
import { HARNESSES } from './harness.mts';
import { adoptLegacyEnv, unknownConfigKeys } from './legacy.mts';
import { killTree, launch, promptPath } from './process.mts';
import { type Gate, type Item, type Pull, loadTracker } from './tracker.mts';

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
const BASE: string = opt.base ?? config.deliver?.base ?? 'release/next';
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
const PROTECTED: string[] = config.deliver?.protectedPaths ?? [
  '.github/',
  '.agents/',
  '.claude/',
  'package.json',
  'pnpm-workspace.yaml',
  'Cargo.toml',
  'pyproject.toml',
  'go.mod',
  'Directory.Packages.props',
];
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
const tracker = await loadTracker(opt.tracker ?? config.deliver?.tracker ?? 'github', {
  cwd: root,
  base: BASE,
  selection: { milestone: opt.milestone, issues: opt.issues?.split(',').map((nr) => nr.trim()) },
  trustAuthors: opt['trust-authors'],
}).catch((error) => fail(`tracker: ${firstLine(error)}`, 64));
const tokenSource = app ? makeSource(app, tracker.repo, SESSION_MINUTES * 60_000) : undefined;
const runId = `${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}-${process.pid}`;
const runDir = path.join(commonDir, 'deliver', runId);
let emit: Emit = () => {};

/** One line of the stream-json of Claude Code, as far as the loop reads it. */
type StreamRecord = {
  type?: string;
  num_turns?: number;
  total_cost_usd?: number;
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
  const session: Session = { exit: null, turns: 0, costUsd: 0, peakContext: 0 };
  const out = createWriteStream(file);
  return new Promise((done) => {
    const child = launch(argv, {
      cwd,
      stdio: ['ignore', 'pipe', 'inherit'],
      env,
    });
    const timer = setTimeout(() => killTree(child), SESSION_MINUTES * 60_000);
    const stop = () => killTree(child);
    stopSession = stop;
    createInterface({ input: child.stdout! }).on('line', (line) => {
      out.write(`${line}\n`);
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
      if (stopSession === stop) stopSession = undefined;
      out.end();
      session.exit = code;
      done(session);
    });
  });
}

const CLOSED = 'pull request closed';

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
      // the tracker calls block: a stop request that came in meanwhile is only seen after a turn of the event loop
      await new Promise((turn) => setTimeout(turn, 0));
      if (stopped) break;
      // the files of the commit that is merged, not of the one the session left: a later push is checked too.
      // The merge names gate.head, so a push after this read is refused by the tracker.
      const handsOff = await guard(pull);
      if (handsOff) return handsOff;
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

async function deliver(item: Item): Promise<{ reason?: string; pull?: Pull }> {
  const task = `issue-${item.id}`;
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
    const session = await startSession(
      item,
      worktree,
      path.join(runDir, `${item.id}-${round}.jsonl`),
    );
    sessions.push(session);
    reason = undefined;
    pull = tracker.pullOf(item);
    const settle = () => {
      if (reason) reason = withBlocked(reason, session);
    };
    // a stopped or failed session never leads to a merge, also when a pull request is open
    if (stopped) reason = 'stopped';
    else if (session.exit !== 0) reason = `session failed (exit ${session.exit})`;
    // the session asked a question: a pull request of an earlier run is not its answer
    else if (tracker.needsDecision(item)) reason = 'needs-decision';
    else if (!pull) reason = 'session ended without a pull request';
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
    attempt('git', ['worktree', 'remove', '--force', worktree], root);
    attempt('git', ['branch', '-D', pull.branch], root);
    tracker.dropBranch(pull);
  } else {
    // not merged: the worktree may hold work that is not pushed
    log(`#${item.id} worktree kept: ${worktree}`, 'warn');
  }
  appendFileSync(
    path.join(runDir, 'results.jsonl'),
    `${JSON.stringify({
      issue: item.id,
      title: item.title,
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
emit = openEvents(process.env.AGENT_EVENTS_DIR ?? path.join(commonDir, '.agents', 'events'), runId);
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
    let next: Item | undefined;
    for (const item of open) {
      if (aside.has(item.id) || handedOver.has(item.id)) continue;
      const reason = tracker.waitReason(item);
      if (reason) waiting.push(`#${item.id} ${reason}`);
      else if (!next) next = item;
    }
    if (!next) break;
    log(`#${next.id} start: ${next.title} (${open.length} open)`, 'info');
    emit('task.started', { task: `issue-${next.id}`, subject: tracker.itemSubject(next) });
    // a failing tracker or git call sets the issue aside, it does not end the run
    const { reason, pull } = await deliver(next).catch(
      (error): { reason?: string; pull?: Pull } => ({ reason: `error: ${firstLine(error)}` }),
    );
    if (!reason) {
      merged.push(`#${next.id} ${pull?.url}`);
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

needsYou = [...[...handedOver].map(([nr, why]) => `#${nr} ${why}`), ...needsYou];
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
if (handedOver.size) {
  say(
    'next step: merge the pull request above yourself, then start the loop again with the same arguments',
    'warn',
  );
}
const clean = !releaseError && aside.size === 0 && handedOver.size === 0 && waiting.length === 0;
// An incomplete run (issues set aside or waiting) is no success: the agent-events format has no
// other outcome for it than `failed`; the counts are in the text.
emit(
  'run.finished',
  {
    outcome: stopped ? 'cancelled' : clean ? 'succeeded' : 'failed',
    ...(stopped || clean ? {} : { reason: 'incomplete' }),
    text: `merged ${merged.length}, set aside ${aside.size}, waiting ${waiting.length}${needsYou.length ? `, needs you ${needsYou.length}` : ''}`,
  },
  stopped ? 'neutral' : clean ? 'success' : 'warning',
);
process.exit(stopped ? 130 : clean ? 0 : 2);
