#!/usr/bin/env node
// Gate `verify-verdict <file> <pr> [--head <sha>]` (references/gates.md): the verdict file of a review session holds
// a valid `approve` for the commit the pull request is at. The loop calls `verifyVerdict` for its file check.
import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Verdict, parseVerdict } from '../review.mts';
import { loadTracker } from '../tracker.mts';
import { type GateResult, UsageError, gateMain } from './result.mts';

/** `verdict`: set when the file holds a valid verdict for the head of the pull request; it is not printed. */
export type VerdictResult = GateResult & { verdict?: Verdict };

/** `content`: the text of the verdict file, `undefined` without one. `reviewedHead`: the commit that was reviewed. */
export function verifyVerdict(input: {
  content: string | undefined;
  reviewedHead: string;
  prHead: string;
}): VerdictResult {
  const { content, reviewedHead, prHead } = input;
  const fail = (reason: string, evidence: Record<string, unknown> = {}): VerdictResult => ({
    result: 'fail',
    reason,
    evidence,
  });
  if (content === undefined) return fail('no verdict');
  const verdict = parseVerdict(content);
  if (!verdict) return fail('invalid verdict');
  if (reviewedHead !== prHead)
    return fail(`head mismatch: reviewed ${reviewedHead}, the pull request is at ${prHead}`, {
      reviewedHead,
      prHead,
    });
  const { findings, unmet } = verdict;
  if (verdict.verdict === 'changes')
    return { ...fail('the review asks for changes', { findings, unmet }), verdict };
  return { result: 'pass', reason: 'approved', evidence: { head: prHead }, verdict };
}

const git = (...args: string[]): string =>
  execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const readIfThere = (file: string): string | undefined => {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
};

/** The commit the pull request is at, read through the tracker of the repository (`deliver.tracker`). */
async function pullHead(id: number): Promise<string> {
  const root = git('rev-parse', '--show-toplevel');
  // a test hook that points into the repository would let the reviewed change decide the result
  const hook = process.env.DELIVER_TRACKER_DIR;
  if (hook) {
    const rel = path.relative(realpathSync.native(root), realpathSync.native(hook));
    if (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`))
      throw new UsageError('DELIVER_TRACKER_DIR must not be inside the repository');
  }
  const config = JSON.parse(readIfThere(path.join(root, '.agents/config.json')) ?? '{}') as {
    deliver?: { tracker?: string };
  };
  const tracker = await loadTracker(config.deliver?.tracker ?? 'github', {
    cwd: root,
    // the head of a pull request depends on neither the base nor a selection
    base: '',
    selection: {},
    trustAuthors: false,
  });
  return tracker.compareRefs({ id, title: '', url: '', branch: '' }).head;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await gateMain(async (args) => {
    const { values, positionals } = parseArgs({
      args,
      options: { head: { type: 'string' } },
      allowPositionals: true,
    });
    const [file, pr, ...rest] = positionals;
    if (!file || !pr || rest.length || !/^[1-9]\d*$/.test(pr) || values.head === '')
      throw new UsageError('verify-verdict <file> <pr> [--head <sha>]');
    return verifyVerdict({
      content: readIfThere(file),
      // without --head the checkout is the reviewed commit: a review runs in a worktree detached at it
      reviewedHead: values.head ?? git('rev-parse', 'HEAD'),
      prHead: await pullHead(Number(pr)),
    });
  });
}
