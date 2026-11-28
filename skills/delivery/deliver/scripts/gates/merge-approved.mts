// Gate `merge-approved`: one merge attempt of an approved pull request (ADR 0012, references/gates.md). Only the
// reviewed commit `<sha>` is merged, and only with an approving verdict and a passing guard; anything unknown fails
// closed. The script holds no lock and does not wait: an executor calls it under its merge lock of the base branch,
// backs off on `retry` and decides when checks that never report count as reported. The CLI wraps `mergeApproved`:
//   node scripts/gates/merge-approved.mts <pr> <sha> --verdict <file> (--risk <level> | --result-file <file>)
//     [--tracker <name>] [--unreported-ok]
import { readFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { type Gate, type Pull, type Tracker, loadTracker } from '../tracker.mts';
import { HANDS_OFF, checkoutRoot, guardArgs, guardCli, trackerDirOutside } from './guard.mts';
import { type GateResult, UsageError, gateMain } from './result.mts';
import { verifyVerdict } from './verify-verdict.mts';

/** The reason of a closed pull request; the loop sets the issue aside without a repair session. */
export const CLOSED = 'pull request closed';

const firstLine = (error: unknown): string =>
  String((error as Error)?.message ?? error)
    .trim()
    .split('\n')[0];

export type MergeApprovedInput = {
  tracker: Pick<Tracker, 'gate' | 'merge'>;
  pull: Pull;
  /** The reviewed commit: the only one that is merged. */
  sha: string;
  /**
   * The verdict check (`verifyVerdict`); merged only when it is `pass` with `evidence.head` equal to `sha`. The function
   * cannot see which commit was reviewed: the caller binds the verdict to `sha` (the CLI by the `head` of the file).
   */
  verdict: GateResult | undefined;
  /** The guard of the commit `head` (`guardCheck` or the guard CLI); called only for `sha`, right before the merge. */
  guard: (head: string) => GateResult | Promise<GateResult>;
  /** The executor has waited long enough: a ready gate without any reported check counts as reported. */
  unreportedOk?: boolean;
  /**
   * Called once the gate is ready (before the head check) and again after the guard, right before the merge: a
   * result ends the attempt with it and nothing is merged (the loop reports a stop request, the CLI a retargeted
   * base). `undefined` goes on.
   */
  checkpoint?: () => GateResult | undefined | Promise<GateResult | undefined>;
};

/**
 * One merge attempt. `pass`: `sha` merged now, or the pull request was already merged (by anyone; the gate does not
 * say at which commit). `retry`: checks pending or not reported (`evidence.reported`),
 * a failing tracker read (`evidence.error`). `owner`: a verdict that is not `pass` or whose `evidence.head` is not
 * `sha`, a head other than `sha`, a
 * guard that does not pass. `fail`: closed, conflict (`evidence.conflict`), red, merge refused (`evidence.refused`).
 */
export async function mergeApproved(input: MergeApprovedInput): Promise<GateResult> {
  const { tracker, pull, sha, verdict, guard, unreportedOk = false, checkpoint } = input;
  const pr = pull.id;
  const owner = (reason: string, evidence: Record<string, unknown> = {}): GateResult => ({
    result: 'owner',
    reason: `${reason}${HANDS_OFF}`,
    evidence: { pr, sha, ...evidence },
  });
  const fail = (reason: string, evidence: Record<string, unknown> = {}): GateResult => ({
    result: 'fail',
    reason,
    evidence: { pr, sha, ...evidence },
  });
  const retry = (reason: string, evidence: Record<string, unknown>): GateResult => ({
    result: 'retry',
    reason,
    evidence: { pr, sha, ...evidence },
  });

  // fails closed (ADR 0012): without an approval of exactly this commit nothing is read or merged
  if (verdict?.result !== 'pass')
    return owner(`no approving verdict (${verdict?.reason ?? 'none'})`, {
      verdict: verdict?.result ?? null,
    });
  if (verdict.evidence.head !== sha)
    return owner(`the verdict is not of ${sha}`, { verdictHead: verdict.evidence.head ?? null });

  let gate: Gate;
  try {
    gate = tracker.gate(pull);
  } catch (error) {
    // a tracker call that fails once (network, rate limit) is not a verdict on the pull request
    return retry(`tracker error: ${firstLine(error)}`, { error: firstLine(error) });
  }
  if (gate.state === 'merged')
    return { result: 'pass', reason: 'already merged', evidence: { pr } };
  if (gate.state === 'closed') return fail(CLOSED);
  if (gate.state === 'conflict') return fail(gate.detail, { conflict: true });
  if (gate.state === 'red') return fail(`red: ${gate.detail}`);
  // checks register a moment after the pull request opens: nothing reported is not green yet
  if (gate.state === 'pending') return retry('checks pending', { reported: gate.reported });
  if (gate.state !== 'ready') return fail(`unknown gate state ${String(gate.state)}`);
  if (!gate.reported && !unreportedOk) return retry('no check reported yet', { reported: false });
  let stopped = await checkpoint?.();
  if (stopped) return stopped;
  // only the approved commit is merged: what was pushed after the review was seen by nobody
  if (gate.head !== sha) return owner('pushed after the review', { prHead: gate.head });
  // the files of the commit that is merged; the merge names `sha`, so a push after this read is refused by the tracker
  let guarded: GateResult;
  try {
    guarded = await guard(sha);
  } catch (error) {
    if (error instanceof UsageError) throw error;
    guarded = owner(`guard failed (${firstLine(error)})`);
  }
  // the guard blocks too: a stop request during it is seen before the merge and before a hand-over
  stopped = await checkpoint?.();
  if (stopped) return stopped;
  if (guarded.result !== 'pass') {
    const reason = guarded.reason.endsWith(HANDS_OFF)
      ? guarded.reason
      : `guard ${guarded.result}: ${guarded.reason}${HANDS_OFF}`;
    return { result: 'owner', reason, evidence: { pr, sha, guard: guarded.evidence } };
  }
  try {
    tracker.merge(pull, sha);
  } catch (error) {
    return fail(`merge refused: ${firstLine(error)}`, { refused: true });
  }
  return { result: 'pass', reason: `merged ${sha}`, evidence: { pr, sha } };
}

const USAGE =
  'usage: merge-approved <pr> <sha> --verdict <file> (--risk <level> | --result-file <file>) [--tracker <name>] [--unreported-ok]';

const readIfThere = (file: string): string | undefined => {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
};

/** The `head` the verdict file names: the commit the review session was detached at. */
const verdictHead = (content: string): unknown => {
  try {
    return (JSON.parse(content) as { head?: unknown } | null)?.head;
  } catch {
    return undefined;
  }
};

/**
 * The CLI. Settings never come from the checkout: the base branch (required checks, merge method) and the title are
 * read from the pull request; protected paths, `mergeRisk` and the tracker check from the config at its merge base
 * (the guard CLI, no flag can raise `mergeRisk`). The risk level comes from `--risk` or `risk.level` of
 * `--result-file`; without one nothing is merged. The verdict file must name `head` equal to `<sha>`: an approval of
 * another commit is no approval of this one.
 */
export async function mergeApprovedCli(args: string[]): Promise<GateResult> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      verdict: { type: 'string' },
      risk: { type: 'string' },
      'result-file': { type: 'string' },
      tracker: { type: 'string' },
      'unreported-ok': { type: 'boolean' },
    },
  });
  const [pr, sha, ...rest] = positionals;
  if (!pr || !sha || rest.length > 0 || !/^[1-9]\d*$/.test(pr)) throw new UsageError(USAGE);
  if (!/^[0-9a-f]{6,64}$/.test(sha)) throw new UsageError(`<sha> is a commit id, not "${sha}"`);
  if (!values.verdict) throw new UsageError(`--verdict <file> is required; ${USAGE}`);
  const trackerName = values.tracker ?? 'github';
  const id = Number(pr);
  const owner = (reason: string, evidence: Record<string, unknown> = {}): GateResult => ({
    result: 'owner',
    reason: `${reason}${HANDS_OFF}`,
    evidence: { pr: id, sha, ...evidence },
  });
  // wrong guard flags are usage now, not after the checks turned green
  const { risk } = guardArgs([
    pr,
    ...(values.risk === undefined ? [] : ['--risk', values.risk]),
    ...(values['result-file'] === undefined ? [] : ['--result-file', values['result-file']]),
  ]);
  // a skipped step fails closed (ADR 0012): an unknown risk is not medium here
  if (risk === undefined)
    return owner('no risk level (--risk, or risk.level of --result-file)', {
      resultFile: values['result-file'] ?? null,
    });
  // the level read now is the one judged: the result file is not read again
  const guardArgv = [pr, '--head', sha, '--tracker', trackerName, '--risk', risk];

  const content = readIfThere(values.verdict);
  const verdict = verifyVerdict({ content, reviewedHead: sha, prHead: sha });
  // the verdict object itself is not printed
  let verdictResult: GateResult = {
    result: verdict.result,
    reason: verdict.reason,
    evidence: verdict.evidence,
  };
  const named = content === undefined ? undefined : verdictHead(content);
  if (verdictResult.result === 'pass' && named !== sha)
    verdictResult = {
      result: 'fail',
      reason:
        typeof named === 'string'
          ? `the verdict is of ${named}, not of ${sha}`
          : 'the verdict file names no head',
      evidence: { verdictHead: typeof named === 'string' ? named : null },
    };

  const root = checkoutRoot();
  trackerDirOutside(root);
  const context = { cwd: root, selection: {}, trustAuthors: false };
  let tracker: Tracker;
  let pull: Pull;
  let base: string;
  try {
    // the base branch decides the required checks and the merge method: it comes from the pull request
    ({ pull, base } = (await loadTracker(trackerName, { ...context, base: '' })).pullRequest(
      Number(pr),
    ));
    tracker = await loadTracker(trackerName, { ...context, base });
  } catch (error) {
    return { result: 'fail', reason: `tracker: ${firstLine(error)}`, evidence: { pr: id } };
  }
  if (pull.id !== id)
    return { result: 'fail', reason: `tracker: read #${pull.id} for #${pr}`, evidence: {} };

  const result = await mergeApproved({
    tracker,
    pull,
    sha,
    verdict: verdictResult,
    guard: () => guardCli(guardArgv),
    unreportedOk: values['unreported-ok'] ?? false,
    // a pull request retargeted after its base was read would merge with the checks and method of another branch
    checkpoint: () => {
      let now: string;
      try {
        now = tracker.pullRequest(pull.id).base;
      } catch (error) {
        return {
          result: 'retry',
          reason: `tracker error: ${firstLine(error)}`,
          evidence: { pr: pull.id, sha, error: firstLine(error) },
        };
      }
      return now === base
        ? undefined
        : {
            result: 'owner',
            reason: `base changed from ${base} to ${now}${HANDS_OFF}`,
            evidence: { pr: pull.id, sha, base, prBase: now },
          };
    },
  });
  result.evidence = { base, ...result.evidence };
  return result;
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await gateMain(mergeApprovedCli);
}
