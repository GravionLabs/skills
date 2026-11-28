#!/usr/bin/env node
// Gate `stage`: reads and writes the `agent:*` stage label of an issue (ADR 0009) through the tracker.
// `node gates/stage.mts get <issue>` or `set <issue> <stage>`, with `--tracker <name>` and `--repo <owner/name>`.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { STAGES, type Stage, stageOf } from '../stage.mts';
import { type Item, type Tracker, loadTracker } from '../tracker.mts';
import { isRateLimit } from '../tracker/github.mts';
import { type GateResult, UsageError, gateMain } from './result.mts';

const USAGE = `usage: stage.mts get <issue> | set <issue> <${STAGES.join('|')}>`;

/** The result of a failed tracker call: `retry` for a rate limit, else `fail`. */
function trackerError(error: unknown, evidence: Record<string, unknown>): GateResult {
  const e = error as { stderr?: string; message?: string };
  const reason = String(e.stderr || e.message || error)
    .trim()
    .split('\n')[0]!;
  // stderr only, when there is one: the message of a failed command repeats its arguments
  const limited = isRateLimit(e.stderr ?? e.message ?? '');
  return { result: limited ? 'retry' : 'fail', reason, evidence };
}

/** The stage the labels of the issue name, `null` without one. */
export function getStageGate(tracker: Tracker, issue: number): GateResult {
  try {
    const found = tracker.issue({ repo: tracker.repo, number: issue });
    if (!found)
      return {
        result: 'fail',
        reason: `#${issue} not found in ${tracker.repo}`,
        evidence: { issue },
      };
    const stage = stageOf(found.labels) ?? null;
    return {
      result: 'pass',
      reason: `#${issue} ${stage ? `is in stage ${stage}` : 'has no stage'}`,
      evidence: { issue, stage },
    };
  } catch (error) {
    return trackerError(error, { issue });
  }
}

/**
 * Sets the stage of the item; `undefined` removes every `agent:*` label. `createLabels` creates the missing
 * labels of the repository first (the loop does that once at its start).
 */
export function setStageGate(
  tracker: Pick<Tracker, 'setStage' | 'syncStageLabels'>,
  item: Item,
  stage: Stage | undefined,
  { createLabels = false }: { createLabels?: boolean } = {},
): GateResult {
  const evidence = { issue: item.id, stage: stage ?? null };
  try {
    const created = createLabels ? tracker.syncStageLabels() : [];
    tracker.setStage(item, stage);
    return {
      result: 'pass',
      reason: `#${item.id} ${stage ? `set to stage ${stage}` : 'has no stage'}`,
      evidence: { ...evidence, ...(created.length > 0 && { created }) },
    };
  } catch (error) {
    return trackerError(error, evidence);
  }
}

/** The tracker of the checkout: the flag, then `deliver.tracker` of .agents/config.json, else `github`. */
async function checkoutTracker(name: string | undefined, repo: string | undefined) {
  let root = process.cwd();
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // no checkout: the tracker needs `--repo`
  }
  let config: { deliver?: { tracker?: string; base?: string } } = {};
  try {
    config = JSON.parse(readFileSync(path.join(root, '.agents/config.json'), 'utf8'));
  } catch {
    // no project config
  }
  return loadTracker(name ?? config.deliver?.tracker ?? 'github', {
    cwd: root,
    repo,
    base: config.deliver?.base ?? 'release/next',
    selection: {},
    trustAuthors: false,
    log: (text) => console.error(text),
  });
}

async function main(args: string[]): Promise<GateResult> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { tracker: { type: 'string' }, repo: { type: 'string' } },
  });
  const [action, number, stage, ...rest] = positionals;
  if (
    (action !== 'get' && action !== 'set') ||
    !/^[1-9]\d*$/.test(number ?? '') ||
    (action === 'get') !== (stage === undefined) ||
    rest.length > 0
  )
    throw new UsageError(USAGE);
  if (stage !== undefined && !(STAGES as readonly string[]).includes(stage))
    throw new UsageError(`unknown stage "${stage}": one of ${STAGES.join(', ')}`);
  const issue = Number(number);
  if (values.tracker !== undefined && !/^[a-z][a-z0-9-]*$/.test(values.tracker))
    throw new UsageError(`invalid tracker name: ${values.tracker}`);
  let tracker: Tracker;
  try {
    tracker = await checkoutTracker(values.tracker, values.repo);
  } catch (error) {
    return trackerError(error, { issue });
  }
  if (action === 'get') return getStageGate(tracker, issue);
  const item: Item = { id: issue, title: '', url: '', labels: [], body: '' };
  return setStageGate(tracker, item, stage as Stage, { createLabels: true });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  await gateMain(main);
