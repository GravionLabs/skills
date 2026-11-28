#!/usr/bin/env node
// Gate `release-gate`: may `release/next` go to its release pull request (ADR 0012)? It only reads.
// `node gates/release-gate.mts <owner/name> --milestone <M>`, with `--base <branch>` and `--tracker <name>`.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Item, type Pull, type Tracker, loadTracker } from '../tracker.mts';
import { isRateLimit } from '../tracker/github.mts';
import { type GateResult, UsageError, gateMain } from './result.mts';

const USAGE = 'usage: release-gate.mts <owner/name> --milestone <M> [--base <branch>]';

/** The first line of the retro comment, as `retro --post` writes it: the name without the version of a released milestone. */
export const retroMarker = (milestone: string): string =>
  `<!-- retro: ${milestone.replace(/ \(\d+\.\d+\.\d+\)$/, '')} -->`;

export type ReleaseEvidence = {
  milestone: string;
  /** The URL of the publish job (or run) that runs or failed. */
  job?: string;
  /** The open PBIs and Bugs of the milestone. With any of them the fields below are not read. */
  open?: number[];
  /** The open pull requests into the base that are not of the milestone. */
  pulls?: Pull[];
  releaseTests?: Item[];
  /** The URL of the open release pull request. */
  releasePull?: string;
  /** The retro comment exists: no further retro in this release. */
  retroDone?: boolean;
  retro?: string;
  /** The reads that failed, by field (`publish`, `open`, `pulls`, …): the first line of the error. */
  unread: Record<string, string>;
};

const messageOf = (error: unknown): string => {
  const e = error as { stderr?: string; message?: string };
  return String(e.stderr || e.message || error)
    .trim()
    .split('\n', 1)
    .join('');
};

/**
 * The release gate of the base branch for `milestone`, the milestone selection of the tracker. `fail`: a failed
 * publish job or a failed read; `retry`: open leaves, a running publish job or a rate limit; `owner`: a person acts
 * (foreign pull requests, a release test, a ready release pull request); `pass`: retro and release pull request may
 * be done. Every read is tried, so an executor can use what was read.
 */
export function releaseGate({
  tracker,
  milestone,
}: {
  tracker: Tracker;
  milestone: string;
}): GateResult & { evidence: ReleaseEvidence } {
  const evidence: ReleaseEvidence = { milestone, unread: {} };
  let limited = false;
  const read = <T,>(field: string, from: () => T): T | undefined => {
    try {
      return from();
    } catch (error) {
      // stderr only, when there is one: the message of a failed command repeats its arguments
      const e = error as { stderr?: string; message?: string };
      limited ||= isRateLimit(e.stderr ?? e.message ?? '');
      evidence.unread[field] = messageOf(error);
      return undefined;
    }
  };
  const result = (word: GateResult['result'], reason: string) => ({
    result: word,
    reason,
    evidence,
  });
  const unreadable = () =>
    result(
      limited ? 'retry' : 'fail',
      Object.entries(evidence.unread)
        .map(([field, why]) => `${field} not read: ${why}`)
        .join('; '),
    );

  const publish = read('publish', () => tracker.publishState());
  if (publish?.url && (publish.state === 'failed' || publish.state === 'running'))
    evidence.job = publish.url;
  const open = read('open', () => tracker.items().map((item) => item.id));
  if (open) evidence.open = open;
  const failed = () => result('fail', `publish job failed: ${publish?.url}`);
  if (open?.length) {
    if (publish?.state === 'failed') return failed();
    return result('retry', `open in ${milestone}: ${open.map((id) => `#${id}`).join(', ')}`);
  }

  const pulls = read('pulls', () => tracker.foreignPulls());
  if (pulls) evidence.pulls = pulls;
  const tests = read('releaseTests', () => tracker.releaseTests());
  if (tests) evidence.releaseTests = tests;
  const ready = read('releasePull', () => {
    const pull = tracker.releasePull();
    if (!pull) return false;
    evidence.releasePull = pull.url;
    const gate = tracker.gate(pull);
    return gate.state === 'ready' && gate.reported;
  });
  read('retroDone', () => {
    const url = tracker.retroComment(retroMarker(milestone));
    evidence.retroDone = Boolean(url);
    if (url) evidence.retro = url;
  });

  if (publish?.state === 'failed') return failed();
  if (publish?.state === 'running') return result('retry', `publish job running: ${publish.url}`);
  if (Object.keys(evidence.unread).length > 0) return unreadable();
  const waits = [
    ...(pulls ?? []).map((pull) => `${pull.url} is open into the base, not in ${milestone}`),
    ...(tests ?? []).map((test) => `release test #${test.id} is open`),
    ...(ready ? [`release pull request ${evidence.releasePull} is ready: a person merges it`] : []),
  ];
  if (waits.length > 0) return result('owner', waits.join('; '));
  return result('pass', `${milestone} is ready for its release pull request`);
}

async function main(args: string[]): Promise<GateResult> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      milestone: { type: 'string' },
      base: { type: 'string' },
      tracker: { type: 'string' },
    },
  });
  const [repo, ...rest] = positionals;
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo ?? '') || rest.length > 0 || !values.milestone)
    throw new UsageError(USAGE);
  let root = process.cwd();
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // no checkout: the repository is named
  }
  let config: { deliver?: { tracker?: string; base?: string } } = {};
  try {
    config = JSON.parse(readFileSync(path.join(root, '.agents/config.json'), 'utf8'));
  } catch {
    // no project config
  }
  const name = values.tracker ?? config.deliver?.tracker ?? 'github';
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new UsageError(`invalid tracker name: ${name}`);
  const tracker = await loadTracker(name, {
    cwd: root,
    repo,
    base: values.base || config.deliver?.base || 'release/next',
    selection: { milestone: values.milestone },
    trustAuthors: false,
    log: (text) => console.error(text),
  });
  return releaseGate({ tracker, milestone: values.milestone });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  await gateMain(main);
