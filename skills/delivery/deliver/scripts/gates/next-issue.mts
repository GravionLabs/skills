#!/usr/bin/env node
// Gate `next-issue <issue|milestone>` (references/gates.md): the next ready PBI or Bug of the tree below a Feature,
// Epic, Objective or milestone. The deliver loop picks its items with the same `inPickOrder`.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { issueTier } from '../session-models.mts';
import { type Item, type Tracker, loadTracker } from '../tracker.mts';
import { type GateResult, UsageError, gateMain } from './result.mts';

/**
 * `items` in their order, each with why it cannot start now (`reason` unset: ready). Lazy: `waitReason` is only
 * asked for the items the caller reads.
 */
export function* inPickOrder<T extends Item>(
  items: T[],
  waitReason: (item: T) => string | undefined,
): Generator<{ item: T; reason: string | undefined }> {
  for (const item of items) yield { item, reason: waitReason(item) };
}

/** The first ready leaf below `ref`; none ready: `issue: null` and every held leaf with its reason. */
export function nextIssue({
  tracker,
  ref,
}: {
  tracker: Pick<Tracker, 'repo' | 'leaves' | 'waitReason'>;
  ref: string;
}): GateResult {
  const leaves = tracker.leaves(ref);
  if (!leaves)
    throw new UsageError(`${ref} is no Feature, Epic, Objective or milestone of ${tracker.repo}`);
  const waiting: Record<string, unknown>[] = [];
  const reasonOf = (leaf: (typeof leaves)[number]) => leaf.held ?? tracker.waitReason(leaf);
  for (const { item, reason } of inPickOrder(leaves, reasonOf)) {
    const found = { repo: item.repo ?? tracker.repo, number: item.id, title: item.title };
    if (reason) {
      waiting.push({ ...found, reason });
      continue;
    }
    // without a `Tier:` line the loop implements with `standard`
    const tier = issueTier(item.body).tier ?? 'standard';
    return {
      result: 'pass',
      reason: `${found.repo}#${found.number} is next below ${ref}`,
      evidence: { issue: { ...found, tier } },
    };
  }
  return {
    result: 'pass',
    reason: waiting.length
      ? `nothing below ${ref} is ready: ${waiting.length} held`
      : `no open PBI or Bug below ${ref}`,
    evidence: { issue: null, waiting },
  };
}

/** `deliver.tracker` of the project config of the checkout, if any. */
function configuredTracker(cwd: string): string | undefined {
  try {
    const root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return JSON.parse(readFileSync(path.join(root, '.agents/config.json'), 'utf8')).deliver
      ?.tracker;
  } catch {
    return undefined;
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await gateMain(async (args) => {
    const { values, positionals } = parseArgs({
      args,
      allowPositionals: true,
      options: {
        repo: { type: 'string' },
        tracker: { type: 'string' },
        'trust-authors': { type: 'boolean', default: false },
      },
    });
    const [ref, ...rest] = positionals;
    if (!ref || rest.length > 0)
      throw new UsageError('give exactly one issue number or milestone title');
    const cwd = process.cwd();
    const tracker = await loadTracker(values.tracker ?? configuredTracker(cwd) ?? 'github', {
      cwd,
      repo: values.repo,
      // reading the next issue touches no branch
      base: 'release/next',
      selection: {},
      trustAuthors: values['trust-authors'],
      log: (text) => console.error(text),
    });
    return nextIssue({ tracker, ref });
  });
}
