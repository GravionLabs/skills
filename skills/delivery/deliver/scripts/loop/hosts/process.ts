// Default host: the harness runs as a child process of the loop, never through a shell.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { Harness, LoopHost, RawRecord, SessionRequest } from '../host.ts';

/** The argv of a session (the same as the PowerShell loop). */
export function buildArgv(req: Pick<SessionRequest, 'harness' | 'model' | 'prompt'>): string[] {
  return req.harness === 'copilot'
    ? [
        '-p',
        req.prompt,
        '--model',
        req.model,
        '--allow-all-tools',
        '--allow-all-paths',
        '--allow-all-urls',
        '--no-ask-user',
        '--output-format',
        'json',
      ]
    : [
        '-p',
        req.prompt,
        '--model',
        req.model,
        '--permission-mode',
        'auto',
        '--output-format',
        'stream-json',
        '--verbose',
      ];
}

/** The wait ceiling of a harness: the harness stops background tasks after its last turn of `-p` (#461). */
export function ceilingOf(harness: Harness): { name: string; fallback: string } {
  return harness === 'copilot'
    ? { name: 'COPILOT_TASK_WAIT_TIMEOUT_SECONDS', fallback: '3600' }
    : { name: 'CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS', fallback: '0' };
}

/** The `VAR=value` text of the ceiling in effect for a session env. */
export function ceilingText(harness: Harness, env: Record<string, string | undefined>): string {
  const c = ceilingOf(harness);
  return `${c.name}=${env[c.name] || c.fallback}`;
}

/** The environment of a session: a copy, the caller's `base` is not changed. */
export function buildEnv(
  req: SessionRequest,
  base: Record<string, string | undefined> = process.env,
): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...base, ...req.env };
  // nested: the harness gets the run but not the owner marker (its run.started and run.finished are not written)
  env.AGENT_EVENTS_OWNER = '';
  const c = ceilingOf(req.harness);
  if (!env[c.name]) env[c.name] = c.fallback; // a value the user set stays
  return env;
}

export class ProcessHost implements LoopHost {
  async *runSession(req: SessionRequest): AsyncGenerator<RawRecord> {
    const child = spawn(req.harness, buildArgv(req), {
      cwd: req.cwd,
      env: buildEnv(req) as NodeJS.ProcessEnv,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const queue: RawRecord[] = [];
    let wake: (() => void) | null = null;
    const push = (r: RawRecord) => {
      queue.push(r);
      wake?.();
    };
    let pending = 2; // stdout and stderr closed
    let exitCode: number | null = null;
    let ended = false;
    const maybeEnd = () => {
      if (ended || pending > 0 || exitCode === null) return;
      ended = true;
      push({ kind: 'exit', code: exitCode });
    };
    createInterface({ input: child.stdout }).on('line', (line) => push({ kind: 'stdout', line }));
    createInterface({ input: child.stderr }).on('line', (text) => push({ kind: 'stderr', text }));
    child.stdout.on('close', () => {
      pending--;
      maybeEnd();
    });
    child.stderr.on('close', () => {
      pending--;
      maybeEnd();
    });
    child.on('error', (e) => {
      push({ kind: 'stderr', text: `${req.harness}: ${e.message}` });
      pending = 0;
      exitCode = 127;
      maybeEnd();
    });
    child.on('close', (code, signal) => {
      exitCode ??= code ?? (signal ? 128 : 1);
      maybeEnd();
    });
    while (true) {
      while (queue.length) {
        const r = queue.shift() as RawRecord;
        yield r;
        if (r.kind === 'exit') return;
      }
      await new Promise<void>((resolve) => {
        wake = resolve;
        if (queue.length) resolve();
      });
      wake = null;
    }
  }
}

export function createHost(): LoopHost {
  return new ProcessHost();
}
