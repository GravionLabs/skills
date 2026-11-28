// The child-process host of the leaf driver (#1194): the five verbs of references/host-verbs.md, implemented in-process
// for headless harness sessions, wake kind `block`. A worker is one harness process in a worktree of its own; its
// handle is the session id of the run folder (`<runDir>/<handle>.jsonl` holds its output). The host decides nothing:
// it starts, waits, reads and reports. A session that ends without a `result:` line is `error`; `blocked` never occurs
// (a headless session cannot be answered), `answer-worker` is refused and `ask-owner` is deferred.
import { execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { killTree, launch } from './process.mts';

export const WAKE = 'block';

/** The start of a worker, as the step script returns it (`start-worker`). */
export type WorkerStart = {
  role: 'implementer' | 'reviewer';
  name: string;
  brief: string;
  branch: string;
  base: string;
  head?: string;
  model: string;
  env: Record<string, string>;
};

/** The outcome of a verb, in the shape the step script takes back as `result`. */
export type VerbResult = {
  handle?: string;
  name?: string;
  state?: 'done' | 'blocked' | 'error' | 'gone' | 'timeout';
  report?: string;
  question?: string;
  /** `ask-owner` gives `deferred`: nobody answers a child process. */
  answer?: 'sent' | 'refused' | 'owner' | 'deferred';
  error?: string;
};

export type ProcessHostOptions = {
  /** The checkout; the worktrees go beside it, as the loop names them. */
  root: string;
  /** The run folder: the session logs and reports. */
  runDir: string;
  /** The argv of a session of `role`. */
  command(input: { role: WorkerStart['role']; prompt: string; model: string }): string[];
  /** The prompt of a start; default the slash command the brief names. */
  prompt?(start: WorkerStart, issue: number): string | undefined;
  /** The environment of a session (token, run id); the host adds the file variables of the start. */
  env(): Promise<NodeJS.ProcessEnv>;
  /** A slot for one session; the returned function frees it. */
  acquire(): Promise<() => void>;
  stopped(): boolean;
  /** Registers a function that ends a session on a stop request; returns its removal. */
  enlist(stop: () => void): () => void;
  /** A session is ended after this long (the session timeout of the loop). */
  sessionMs: number;
  /** A session that printed its `result:` line and then stays silent this long is ended (done). */
  graceMs: number;
  /** The length of one second of waiting (tests shorten it). */
  tickMs?: number;
  /** Each line a session prints. */
  onLine?(handle: string, line: string): void;
};

/** What a worker of this host was, for the results of the run. */
export type Session = { handle: string; role: WorkerStart['role']; model: string; exit: number | null };

type Worker = Session & {
  child?: ChildProcess;
  ended: Promise<void>;
  closed: boolean;
  result?: string;
  log: string;
};

/** The variables that name the file of a session: a session gets only its own. */
const FILE_VARIABLES = [
  'DELIVER_RESULT_FILE',
  'DELIVER_REVIEW_FILE',
  'DELIVER_RETRO_FILE',
  'DELIVER_TRIAGE_FILE',
];
const RESULT_LINE =
  /^result: (pr \S+|needs-decision|reviewed (approve|changes)|retro \S+|blocked\b.*)$/;

/** The `result:` line of one output line: plain text, or the final record of a stream-json session. */
export function resultLine(line: string): string | undefined {
  let text = line.trim();
  if (text.startsWith('{')) {
    try {
      const record = JSON.parse(text) as { type?: string; is_error?: boolean; result?: unknown };
      if (record?.type !== 'result' || record.is_error || typeof record.result !== 'string')
        return undefined;
      text = record.result.trimEnd().split('\n').pop()?.trim() ?? '';
    } catch {
      return undefined;
    }
  }
  return RESULT_LINE.test(text) ? text : undefined;
}

/** The slash command of a brief: the first code span after `run`. */
export function commandOf(brief: string): string | undefined {
  return /\brun `(\/[^`]+)`/.exec(brief)?.[1];
}

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const tryGit = (cwd: string, ...args: string[]) => {
  try {
    git(cwd, ...args);
  } catch {
    // reported by the step that needs it
  }
};
const firstLine = (error: unknown): string =>
  String((error as { stderr?: string }).stderr || (error as Error).message || error)
    .trim()
    .split('\n')[0]!;

export function processHost(options: ProcessHostOptions) {
  const { root, runDir } = options;
  const tick = options.tickMs ?? 1000;
  const workers = new Map<string, Worker>();
  const sleep = (seconds: number) => new Promise((done) => setTimeout(done, seconds * tick));
  const worktreeOf = (issue: number, role: WorkerStart['role']) =>
    path.join(
      path.dirname(root),
      `${path.basename(root)}-wt-${issue}${role === 'reviewer' ? '-review' : ''}`,
    );

  /** The implementer works in the loop's worktree of the issue, the reviewer in a fresh one at the reviewed commit. */
  function worktree(start: WorkerStart, issue: number): string {
    const dir = worktreeOf(issue, start.role);
    git(root, 'fetch', '--quiet', 'origin', start.base);
    if (start.role === 'implementer') {
      if (!existsSync(dir)) git(root, 'worktree', 'add', '--detach', dir, `origin/${start.base}`);
      return dir;
    }
    tryGit(root, 'fetch', '--quiet', 'origin', start.branch);
    tryGit(root, 'worktree', 'remove', '--force', dir);
    git(root, 'worktree', 'add', '--quiet', '--detach', dir, start.head ?? `origin/${start.branch}`);
    return dir;
  }

  /** A handle the run folder has no session of yet. */
  function handleOf(name: string): string {
    for (let n = 1; ; n++) {
      const handle = `${name}.${n}`;
      if (!workers.has(handle) && !existsSync(path.join(runDir, `${handle}.jsonl`))) return handle;
    }
  }

  return {
    wake: WAKE,
    /** The workers started so far. */
    sessions: (): Session[] =>
      [...workers.values()].map(({ handle, role, model, exit }) => ({ handle, role, model, exit })),

    /** `start-worker`: a handle, or `error` with the reason (no worktree, no command, a stop). */
    async startWorker(start: WorkerStart): Promise<VerbResult> {
      const issue = Number(/^issue-(\d+)-/.exec(start.name)?.[1]);
      const prompt = options.prompt?.(start, issue) ?? commandOf(start.brief);
      if (!prompt) return { error: `no command in the brief of ${start.name}` };
      mkdirSync(runDir, { recursive: true });
      let cwd: string;
      try {
        cwd = worktree(start, issue);
      } catch (error) {
        return { error: `no worktree: ${firstLine(error)}` };
      }
      const free = await options.acquire();
      if (options.stopped()) {
        free();
        return { error: 'stopped' };
      }
      let env: NodeJS.ProcessEnv;
      try {
        env = { ...(await options.env()) };
      } catch (error) {
        free();
        return { error: firstLine(error) };
      }
      for (const name of FILE_VARIABLES) delete env[name];
      Object.assign(env, start.env);
      const handle = handleOf(start.name);
      const log = path.join(runDir, `${handle}.jsonl`);
      const out = createWriteStream(log);
      const worker = { handle, role: start.role, model: start.model, exit: null, log } as Worker;
      worker.closed = false;
      worker.ended = new Promise<void>((done) => {
        const child = launch(options.command({ role: start.role, prompt, model: start.model }), {
          cwd,
          stdio: ['ignore', 'pipe', 'inherit'],
          env,
        });
        worker.child = child;
        const timer = setTimeout(() => killTree(child), options.sessionMs);
        const unlist = options.enlist(() => killTree(child));
        // a session that printed its result and stays alive (a pending wakeup) is ended after the grace
        let grace: ReturnType<typeof setTimeout> | undefined;
        let finished = false;
        createInterface({ input: child.stdout! }).on('line', (line) => {
          out.write(`${line}\n`);
          clearTimeout(grace);
          const found = resultLine(line);
          if (found) {
            worker.result = found;
            grace = setTimeout(() => {
              finished = true;
              killTree(child);
            }, options.graceMs);
          }
          options.onLine?.(handle, line);
        });
        child.on('error', (error) => out.write(`${JSON.stringify({ error: error.message })}\n`));
        child.on('close', (code) => {
          clearTimeout(timer);
          clearTimeout(grace);
          unlist();
          out.end();
          free();
          worker.exit = finished ? 0 : code;
          worker.closed = true;
          if (start.role === 'reviewer')
            tryGit(root, 'worktree', 'remove', '--force', worktreeOf(issue, 'reviewer'));
          done();
        });
      });
      workers.set(handle, worker);
      return { handle, name: start.name };
    },

    /** `wait-any`: the first worker that ended, `timeout` after `timeout` seconds; no handles: a wait of that length. */
    async waitAny(handles: string[], timeout: number): Promise<VerbResult> {
      if (handles.length === 0) {
        for (let second = 0; second < timeout && !options.stopped(); second++) await sleep(1);
        return { state: 'timeout' };
      }
      const known = handles.map((handle) => workers.get(handle));
      const unknown = handles.find((_, index) => !known[index]);
      if (unknown !== undefined) return { handle: unknown, state: 'error' };
      const state = (worker: Worker): VerbResult => ({
        handle: worker.handle,
        state: worker.result ? 'done' : 'error',
      });
      const ended = known.find((worker) => worker!.closed);
      if (ended) return state(ended);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<VerbResult>((done) => {
        timer = setTimeout(() => done({ handle: handles[0], state: 'timeout' }), timeout * tick);
      });
      try {
        return await Promise.race([
          ...known.map((worker) => worker!.ended.then(() => state(worker!))),
          late,
        ]);
      } finally {
        clearTimeout(timer);
      }
    },

    /** `read-result`: the report file of the worker (its result line, exit and log); empty without a result line. */
    readResult(handle: string): VerbResult {
      const worker = workers.get(handle);
      if (!worker?.result) return { handle, report: '' };
      const report = path.join(runDir, `${handle}.report.md`);
      writeFileSync(
        report,
        `outcome: ${worker.result}\nexit: ${worker.exit}\nlog: ${worker.log}\n`,
      );
      return { handle, report };
    },

    /** `answer-worker`: a headless session cannot be answered. */
    answerWorker(handle: string, question?: string): VerbResult {
      return { handle, answer: 'refused', ...(question !== undefined && { question }) };
    },

    /** `ask-owner`: nobody answers a child process; the lead hands over. */
    askOwner(): { answer: 'deferred' } {
      return { answer: 'deferred' };
    },

    /** Ends every worker that still runs (after the end of the flow or on a stop) and waits for them. */
    async stop(): Promise<void> {
      for (const worker of workers.values()) if (!worker.closed && worker.child) killTree(worker.child);
      await Promise.all([...workers.values()].map((worker) => worker.ended));
    },
  };
}

export type ProcessHost = ReturnType<typeof processHost>;
