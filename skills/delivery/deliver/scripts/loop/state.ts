// State of the loop read from GitHub: open PBIs and Bugs of the targets and the milestone.
// `gh` and the sibling pwsh scripts are child processes behind the Gh interface (tests inject a fake).
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

export const HOLD_LABELS = ['release-test', 'needs-decision', 'needs-refinement', 'interactive'];

/** Reason of the first hold label, null when none holds the PBI. */
export function getHoldReason(labels: string[]): string | null {
  for (const l of HOLD_LABELS) {
    if (labels.includes(l)) return l === 'release-test' ? 'release test' : l;
  }
  return null;
}

export type Gh = {
  /** `gh <args>` parsed as JSON (null when empty). Throws on a non-zero exit. */
  json(args: string[]): Promise<any>;
  /** `pwsh -NoProfile <args>` parsed as JSON. */
  pwshJson(args: string[]): Promise<any>;
};

const run = promisify(execFile);
async function jsonFrom(cmd: string, args: string[]): Promise<any> {
  let out: string;
  try {
    out = (await run(cmd, args, { maxBuffer: 64 * 1024 * 1024 })).stdout;
  } catch (e: any) {
    const stderr = String(e?.stderr ?? '').trim();
    throw new Error(`${cmd} ${args.join(' ')} failed${stderr ? `: ${stderr}` : ''}`);
  }
  return out.trim() ? JSON.parse(out) : null;
}

/** #672: waits in seconds before the 1st, 2nd and 3rd retry of a failed gh call. */
export const GH_RETRY_SECONDS = [5, 30, 120];

/** A rate limit answer of gh (403 or 429): it waits until the reset instead of the fixed retry wait. */
export function isRateLimit(message: string): boolean {
  return /rate limit/i.test(message) || /HTTP 429/.test(message);
}

export type RetryOptions = {
  waits?: number[];
  sleep?: (ms: number) => Promise<void>;
  /** Reset (epoch seconds) of the exhausted limit, null when none is exhausted (`gh api rate_limit`). */
  rateLimitReset?: () => Promise<number | null>;
  now?: () => number;
  onStep?: (line: string) => void;
};

const pad = (n: number) => String(n).padStart(2, '0');
const clock = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;

/**
 * #672: the one gh call of the loop. A failure is retried `waits.length` times (5, 30, 120 s); a rate limit answer with a
 * reset time waits until the reset instead (step line `github: rate limit, waits until <time>`). Still failing: it throws,
 * and the run ends `failed`.
 */
export async function withRetry<T>(
  what: string,
  call: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const waits = opts.waits ?? GH_RETRY_SECONDS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const step = opts.onStep ?? ((line: string) => console.log(line));
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (e: any) {
      const message = String(e?.message ?? e);
      if (attempt >= waits.length)
        throw new Error(`${what} failed after ${waits.length} retries: ${message}`);
      const reset =
        isRateLimit(message) && opts.rateLimitReset ? await opts.rateLimitReset() : null;
      if (reset) {
        step(`github: rate limit, waits until ${clock(new Date(reset * 1000))}`);
        const ms = reset * 1000 - now();
        await sleep(ms > 0 ? ms + 1000 : 0);
      } else {
        step(`github: ${what} failed, retry ${attempt + 1}/${waits.length} in ${waits[attempt]} s`);
        await sleep(waits[attempt] * 1000);
      }
    }
  }
}

/** Waits from a comma list in an environment variable (tests set 0), else the default. */
export function waitsFrom(value: string | undefined, fallback: number[]): number[] {
  const w = (value ?? '')
    .split(/[,\s]+/)
    .filter((x) => /^\d+(\.\d+)?$/.test(x))
    .map(Number);
  return w.length ? w : fallback;
}

async function rateLimitReset(): Promise<number | null> {
  try {
    const r = await jsonFrom('gh', ['api', 'rate_limit']);
    const resets = Object.values<any>(r?.resources ?? {})
      .filter((x) => x && x.remaining === 0 && x.reset)
      .map((x) => Number(x.reset));
    return resets.length ? Math.max(...resets) : null;
  } catch {
    return null;
  }
}

const retrying = (cmd: string, args: string[]) =>
  withRetry(`${cmd} ${args.join(' ')}`, () => jsonFrom(cmd, args), {
    waits: waitsFrom(process.env.DELIVER_GH_RETRY_SECONDS, GH_RETRY_SECONDS),
    rateLimitReset,
  });
export const processGh: Gh = {
  json: (args) => retrying('gh', args),
  pwshJson: (args) => retrying('pwsh', ['-NoProfile', ...args]),
};

export type Pbi = { number: number; labels: string[] };
export type Skipped = { number: number; milestone: string };
export type LoopState = {
  open: number;
  openNrs: number[];
  labels: Record<number, string[]>;
  skipped: Skipped[];
  paused: boolean;
  waitMerge: Record<string, number>;
  eligible: number[];
  ready: number[];
};
export type StateInput = {
  targets: number[];
  milestone: string;
  milestoneScript: string;
  merging?: number[];
  redFirst?: number[];
};

/** Get-Milestones.ps1 of github-milestone, from the directory of scripts/loop: sibling skill (installed) or skills/github (repository). */
export function findMilestoneScript(loopDir: string): string {
  const candidates = ['../../../github-milestone', '../../../../github/github-milestone'].map((p) =>
    join(loopDir, p, 'scripts/Get-Milestones.ps1'),
  );
  return candidates.find((c) => existsSync(c)) ?? candidates[0];
}

const asArray = (v: any): any[] => (Array.isArray(v) ? v : v ? [v] : []);
const names = (labels: any[]): string[] => labels.map((l) => (typeof l === 'string' ? l : l.name));

async function addPbis(
  gh: Gh,
  nr: number,
  seen: Set<number>,
  found: Pbi[],
  ms: string,
  skipped: Skipped[],
): Promise<void> {
  if (seen.has(nr)) return;
  seen.add(nr);
  // REST per issue: `gh issue view` runs on the GraphQL budget
  const issue = await gh.json(['api', `repos/{owner}/{repo}/issues/${nr}`]);
  const labels = names(asArray(issue?.labels));
  if (labels.includes('pbi') || labels.includes('bug')) {
    if (issue.state === 'open') {
      if (ms && issue.milestone?.title !== ms) {
        skipped.push({ number: nr, milestone: issue.milestone ? issue.milestone.title : 'none' });
      } else found.push({ number: nr, labels });
    }
    return;
  }
  const children = asArray(
    await gh.json(['api', `repos/{owner}/{repo}/issues/${nr}/sub_issues?per_page=100`]),
  );
  for (const child of children) await addPbis(gh, Number(child.number), seen, found, ms, skipped);
}

export async function getState(gh: Gh, input: StateInput): Promise<LoopState> {
  const merging = input.merging ?? [];
  const redFirst = input.redFirst ?? [];
  const milestoneArgs = (state: string) => [
    '-File',
    input.milestoneScript,
    '-Mode',
    'issues',
    '-Name',
    input.milestone,
    '-State',
    state,
  ];
  const seen = new Set<number>();
  let found: Pbi[] = [];
  const skipped: Skipped[] = [];
  for (const nr of input.targets) await addPbis(gh, nr, seen, found, '', skipped);
  if (input.milestone) {
    // one REST call lists the milestone; PBIs and Bugs need no read of their own
    const list = await gh.pwshJson(milestoneArgs('open'));
    for (const item of asArray(list?.issues)) {
      const labels = names(asArray(item.labels));
      const n = Number(item.number);
      if (labels.includes('pbi') || labels.includes('bug')) {
        if (!seen.has(n)) {
          seen.add(n);
          found.push({ number: n, labels });
        }
      } else await addPbis(gh, n, seen, found, String(list.milestone?.title ?? ''), skipped);
    }
  }
  // release-test (manual RC test, always last) and merging PBIs are outside the stop-rule set
  found = found.filter((p) => !p.labels.includes('release-test') && !merging.includes(p.number));
  // release-review pause: nothing open, but a closed PBI or Bug of the milestone carries needs-decision
  let paused = false;
  if (input.milestone && found.length === 0) {
    const closed = await gh.pwshJson(milestoneArgs('closed'));
    paused = asArray(closed?.issues).some((i) => {
      const l = names(asArray(i.labels));
      return l.includes('needs-decision') && (l.includes('pbi') || l.includes('bug'));
    });
  }
  const eligible = found.filter((p) => !getHoldReason(p.labels));
  const waitMerge: Record<string, number> = {};
  const ready: Pbi[] = [];
  for (const p of eligible) {
    const blockers = asArray(
      await gh.json([
        'api',
        `repos/{owner}/{repo}/issues/${p.number}/dependencies/blocked_by?per_page=100`,
      ]),
    );
    const open = blockers.filter((b) => b.state === 'open');
    // every open blocker waits for its merge: the PBI waits too, it is not blocked
    if (open.length && open.every((b) => merging.includes(Number(b.number)))) {
      waitMerge[String(p.number)] = Number(open[0].number);
    }
    if (open.length === 0) ready.push(p);
  }
  const sorted = ready.map((p) => p.number).sort((a, b) => a - b);
  const readyNrs = [
    ...redFirst.filter((n) => sorted.includes(n)),
    ...sorted.filter((n) => !redFirst.includes(n)),
  ];
  const labels: Record<number, string[]> = {};
  for (const f of found) labels[f.number] = f.labels;
  return {
    open: found.length,
    openNrs: found.map((p) => p.number),
    labels,
    skipped,
    paused,
    waitMerge,
    eligible: eligible.map((p) => p.number).sort((a, b) => a - b),
    ready: readyNrs,
  };
}

export type MergingEntry = { issue: number | string; state: string; reason?: string };
export type MergingUpdate = { merging: number[]; redFirst: number[]; notes: string[] };

/** Update-Merging over the listing of Get-MergingPrs.ps1; the REST reads are injected. */
export async function updateMerging(
  merging: number[],
  listed: MergingEntry[],
  readIssue: (nr: number) => Promise<{ state: string } | null>,
  readPr: (nr: number) => Promise<{ merged: boolean } | null>,
): Promise<MergingUpdate> {
  const byIssue = new Map(listed.map((x) => [String(x.issue), x]));
  const keep: number[] = [];
  const red: number[] = [];
  const notes: string[] = [];
  for (const nr of merging) {
    const x = byIssue.get(String(nr));
    if (x) {
      if (x.state === 'waiting') {
        keep.push(nr);
        continue;
      }
      if (x.state === 'red-change' || x.state === 'conflict') red.push(nr);
      notes.push(`#${nr} select: leaves merging (${x.state}: ${x.reason ?? ''})`);
      continue;
    }
    const issue = await readIssue(nr);
    if (!issue || issue.state !== 'open') continue;
    const pr = await readPr(nr);
    if (pr?.merged) {
      keep.push(nr);
      continue;
    }
    notes.push(`#${nr} select: leaves merging (PR not merged and without auto-merge)`);
  }
  return { merging: keep, redFirst: red, notes };
}
