// The result contract of the gate scripts (ADR 0012, references/gates.md): a script prints one JSON object
// and sets the exit code of its word; an executor reads the run with `readResult` or `runGate`.
import { spawn } from 'node:child_process';

export const EXIT = { pass: 0, fail: 1, usage: 64, retry: 75, owner: 77 } as const;

export type ResultWord = keyof typeof EXIT;
export type GateResult = {
  result: ResultWord;
  reason: string;
  evidence: Record<string, unknown>;
};

/** Wrong arguments or config: `gateMain` reports it as `usage`. */
export class UsageError extends Error {
  override name = 'UsageError';
}

/** Writes the result as one JSON line to stdout and sets the exit code; a script calls it once. */
export function emit({ result, reason, evidence }: GateResult): void {
  process.stdout.write(`${JSON.stringify({ result, reason, evidence })}\n`);
  process.exitCode = EXIT[result];
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/** The result of a finished script run; every breach of the contract is a `fail` that names it. */
export function readResult(stdout: string, exitCode: number | null): GateResult {
  const broken = (defect: string): GateResult => ({
    result: 'fail',
    reason: `gate result invalid: ${defect}`,
    evidence: { exitCode, stdout: stdout.slice(0, 2000) },
  });
  if (!stdout.trim()) return broken(`no output (exit ${exitCode})`);
  let value: unknown;
  try {
    value = JSON.parse(stdout);
  } catch {
    return broken('stdout is not one JSON object');
  }
  if (!isObject(value)) return broken('stdout is not one JSON object');
  const { result, reason, evidence } = value;
  if (typeof result !== 'string' || !Object.hasOwn(EXIT, result))
    return broken(`unknown result word ${JSON.stringify(result)}`);
  const word = result as ResultWord;
  if (typeof reason !== 'string') return broken('reason is not a string');
  if (!isObject(evidence)) return broken('evidence is not an object');
  if (exitCode !== EXIT[word])
    return broken(`result ${word} needs exit ${EXIT[word]}, got ${exitCode}`);
  return { result: word, reason, evidence };
}

/** Runs `node <script> <args>` and reads its result. Never rejects. */
export function runGate(
  script: string,
  args: string[] = [],
  { cwd, env }: { cwd?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<GateResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    // `close` follows a failed start too; the first call settles the promise
    child.on('error', (error) =>
      resolve({
        result: 'fail',
        reason: `gate did not start: ${error.message}`,
        evidence: { script },
      }),
    );
    child.on('close', (code) => {
      const result = readResult(stdout, code);
      if (stderr && result.result === 'fail') result.evidence.stderr = stderr.slice(-2000);
      resolve(result);
    });
  });
}

const isUsage = (error: unknown): boolean =>
  error instanceof UsageError ||
  // thrown by `util.parseArgs`
  String((error as { code?: unknown } | null)?.code).startsWith('ERR_PARSE_ARGS_');

/**
 * The body of a gate CLI: calls `fn` with the arguments and emits its result. A `UsageError` or an error of
 * `parseArgs` is `usage`, every other error `fail`.
 */
export async function gateMain(
  fn: (args: string[]) => GateResult | Promise<GateResult>,
  args: string[] = process.argv.slice(2),
): Promise<void> {
  let result: GateResult;
  try {
    result = await fn(args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result = {
      result: isUsage(error) ? 'usage' : 'fail',
      reason: message.split('\n')[0] ?? message,
      evidence: {},
    };
  }
  emit(result);
}
