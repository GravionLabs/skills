#!/usr/bin/env node
// Gate `objective-plan <owner>/<repo>#<nr> [--json]` (references/gates.md): the plan of an Objective, read through the
// tracker. `--dry-run` of the loop prints the same plan as lines (`planObjective`).
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type IssueRef, objectivePlan, parseObjective } from '../objective.mts';
import { type Tracker, loadTracker } from '../tracker.mts';
import { UsageError, gateMain } from './result.mts';

const USAGE = 'objective-plan <owner>/<repo>#<nr> [--json]';

/** The tracker of the checkout (`deliver.tracker`), reading for the repository of the Objective. */
async function trackerOf(repo: string): Promise<Tracker> {
  const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  // a test hook that points into the repository would let a merged change decide what runs
  const hook = process.env.DELIVER_TRACKER_DIR;
  if (hook) {
    const rel = path.relative(realpathSync.native(root), realpathSync.native(hook));
    if (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`))
      throw new UsageError('DELIVER_TRACKER_DIR must not be inside the repository');
  }
  let config: { deliver?: { tracker?: string } } = {};
  try {
    config = JSON.parse(readFileSync(path.join(root, '.agents/config.json'), 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const name = config.deliver?.tracker ?? 'github';
  return loadTracker(name, {
    cwd: root,
    repo,
    // the plan depends on neither a base nor a selection
    base: '',
    selection: {},
    trustAuthors: false,
    log: (text) => console.error(text),
  }).catch((error: Error) => {
    throw new UsageError(`tracker: ${error.message}`);
  });
}

function reference(value: string): IssueRef {
  try {
    return parseObjective(value);
  } catch {
    throw new UsageError(USAGE);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await gateMain(async (args) => {
    const { positionals } = parseArgs({
      args,
      // the result is JSON in any case
      options: { json: { type: 'boolean' } },
      allowPositionals: true,
    });
    const [ref, ...rest] = positionals;
    if (!ref || rest.length) throw new UsageError(USAGE);
    const plan = objectivePlan(ref, await trackerOf(reference(ref).repo));
    return {
      result: 'pass',
      reason: `plan of ${ref}: repositories ${plan.repositories.length}, gaps ${plan.gaps.length}`,
      evidence: plan,
    };
  });
}
