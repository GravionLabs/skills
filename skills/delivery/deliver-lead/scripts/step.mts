#!/usr/bin/env node
// The step script of deliver-lead (ADR 0012): `node step.mts leaf <issue> --run <run> [--result <file>]` in the lead's
// checkout prints the one action the lead executes next (leaf.mts), as one JSON line, exit 0. `--result` is a JSON
// file with the outcome of the previous verb. Wrong arguments or config print a gate result (`usage`, exit 64), any
// other error `fail` (exit 1), as the gate scripts do (`emit` of `deliver/scripts/gates/result.mts`).
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { eventsDirectory } from '../../deliver/scripts/event-dir.mts';
import { checkoutRoot, trackerDirOutside } from '../../deliver/scripts/gates/guard.mts';
import { UsageError, emit } from '../../deliver/scripts/gates/result.mts';
import { readLayers } from '../../deliver/scripts/resolve-model.mts';
import { loadTracker } from '../../deliver/scripts/tracker.mts';
import { type Action, type ProjectConfig, type StepResult, leafStep } from './leaf.mts';

const USAGE = 'usage: step.mts leaf <issue> --run <run> [--result <file>]';

function readResultFile(file: string): StepResult {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new UsageError(`--result ${file}: ${(error as Error).message.split('\n')[0]}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new UsageError(`--result ${file}: not a JSON object`);
  return value as StepResult;
}

/** The action of one step; throws `UsageError` for wrong input. */
export async function stepCli(args: string[]): Promise<Action> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { run: { type: 'string' }, result: { type: 'string' } },
  });
  const [flow, number, ...rest] = positionals;
  if (flow !== 'leaf' || !/^[1-9]\d*$/.test(number ?? '') || rest.length > 0 || !values.run)
    throw new UsageError(USAGE);
  const root = checkoutRoot();
  trackerDirOutside(root);
  let config: ProjectConfig = {};
  try {
    config = JSON.parse(readFileSync(path.join(root, '.agents/config.json'), 'utf8'));
  } catch {
    // no project config
  }
  const name = config.deliver?.tracker ?? 'github';
  const context = (base: string) => ({
    cwd: root,
    base,
    selection: {},
    trustAuthors: false,
    log: (text: string) => console.error(text),
  });
  const base = config.deliver?.base ?? 'release/next';
  const tracker = await loadTracker(name, context(base));
  return leafStep({
    tracker,
    trackerAt: (at) => (at === base ? tracker : loadTracker(name, context(at))),
    events: eventsDirectory(),
    issue: Number(number),
    run: values.run,
    result: values.result === undefined ? undefined : readResultFile(values.result),
    cwd: root,
    config,
    layers: readLayers(root),
  });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    process.stdout.write(`${JSON.stringify(await stepCli(process.argv.slice(2)))}\n`);
  } catch (error) {
    // an error takes the form of a gate result: `usage` for wrong input, else `fail`
    const usage =
      error instanceof UsageError ||
      String((error as { code?: unknown } | null)?.code).startsWith('ERR_PARSE_ARGS_');
    const message = String((error as Error)?.message ?? error);
    emit({ result: usage ? 'usage' : 'fail', reason: message.split('\n')[0]!, evidence: {} });
  }
}
