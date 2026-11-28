#!/usr/bin/env node
// Gate `merge-base`: the branch the pull request of a PBI or Bug goes into (ADR 0012).
// `node gates/merge-base.mts <issue>`, with `--base <branch>`, `--tracker <name>` and `--repo <owner/name>`.
// It only names the hotfix path (branch and back-merge); it runs neither.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Tracker, loadTracker } from '../tracker.mts';
import { type GateResult, UsageError, gateMain } from './result.mts';

const USAGE = 'usage: merge-base.mts <issue> [--base <branch>]';
const HOTFIX_LABEL = 'hotfix';
// the higher levels first: an issue that carries one of them is no leaf, whatever else it carries
const LEVELS = ['objective', 'epic', 'feature', 'task', 'pbi', 'bug'];

type Config = { deliver?: { base?: string; tracker?: string } };

/** The level of an issue: its level label, else the `[Level]` prefix of its title. */
export function issueType(labels: string[], title: string): string | undefined {
  const names = new Set(labels.map((label) => label.toLowerCase()));
  const prefix = /^\[([a-z]+)\]/i.exec(title)?.[1]?.toLowerCase();
  return LEVELS.find((level) => names.has(level)) ?? LEVELS.find((level) => level === prefix);
}

/** `fix/<nr>-<slug>`, the slug from the title without its level and Conventional Commit prefix. */
function hotfixBranch({ number, title }: { number: number; title: string }): string {
  const slug = title
    .replace(/^\[[a-z]+\]\s*/i, '')
    .replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '')
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-/, '')
    .slice(0, 40)
    .replace(/-$/, '');
  return `fix/${number}-${slug || HOTFIX_LABEL}`;
}

/**
 * The rule: `flag` (`--base`) wins; a Bug labeled `hotfix` goes into `main`; every other PBI or Bug into
 * `deliver.base` of the config, else `release/next`. `issue` names the hotfix branch.
 */
export function mergeBase({
  issue,
  labels = [],
  type,
  flag,
  config,
}: {
  issue?: { number: number; title: string };
  labels?: string[];
  type: string | undefined;
  flag?: string;
  config?: Config;
}): GateResult {
  const level = type?.toLowerCase();
  const evidence = { ...(issue && { issue: issue.number }) };
  if (level !== 'pbi' && level !== 'bug')
    return {
      result: 'usage',
      reason: `only a PBI or a Bug has a merge base, not ${level ? `a ${level}` : 'an issue without a level'}`,
      evidence,
    };
  const pass = (base: string, hotfix: Record<string, string> = {}): GateResult => ({
    result: 'pass',
    reason: `merge into ${base}`,
    evidence: { ...evidence, base, ...hotfix },
  });
  if (flag) return pass(flag);
  if (level === 'bug' && labels.some((label) => label.toLowerCase() === HOTFIX_LABEL)) {
    if (!issue) throw new UsageError('a hotfix needs the issue to name its branch');
    return pass('main', { branch: hotfixBranch(issue), backmerge: 'main→release/next' });
  }
  return pass(config?.deliver?.base || 'release/next');
}

/** Reads the issue through the tracker and applies the rule; `fail` when it cannot be read. */
export function mergeBaseGate(
  tracker: Pick<Tracker, 'repo' | 'issue'>,
  number: number,
  options: { flag?: string; config?: Config } = {},
): GateResult {
  const failed = (reason: string): GateResult => ({
    result: 'fail',
    reason,
    evidence: { issue: number },
  });
  let found;
  try {
    found = tracker.issue({ repo: tracker.repo, number });
  } catch (error) {
    const e = error as { stderr?: string; message?: string };
    return failed(
      `#${number} not read: ${
        String(e.stderr || e.message || error)
          .trim()
          .split('\n')[0]!
      }`,
    );
  }
  if (!found) return failed(`#${number} not found in ${tracker.repo}`);
  return mergeBase({
    ...options,
    issue: found,
    labels: found.labels,
    type: issueType(found.labels, found.title),
  });
}

async function main(args: string[]): Promise<GateResult> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: { base: { type: 'string' }, tracker: { type: 'string' }, repo: { type: 'string' } },
  });
  const [number, ...rest] = positionals;
  if (!/^[1-9]\d*$/.test(number ?? '') || rest.length > 0 || values.base === '')
    throw new UsageError(USAGE);
  let root = process.cwd();
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    // no checkout: the tracker needs `--repo`
  }
  let config: Config = {};
  try {
    config = JSON.parse(readFileSync(path.join(root, '.agents/config.json'), 'utf8'));
  } catch {
    // no project config
  }
  const name = values.tracker ?? config.deliver?.tracker ?? 'github';
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new UsageError(`invalid tracker name: ${name}`);
  const tracker = await loadTracker(name, {
    cwd: root,
    repo: values.repo,
    base: config.deliver?.base ?? 'release/next',
    selection: {},
    trustAuthors: false,
    log: (text) => console.error(text),
  });
  return mergeBaseGate(tracker, Number(number), { flag: values.base, config });
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url))
  await gateMain(main);
