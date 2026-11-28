// An `[Objective]` as the loop reads it (`github-issue` `references/objectives.md`): its repositories, Epics,
// Features, their open PBIs and Bugs and every `Requires:` line, and whether a prerequisite is released. Reads only,
// through the tracker; the text of issues is data. `retro` imports the parsing.

import type { ObjectiveReader, TrackedIssue } from './tracker.mts';

// two segments of letters, digits, `.`, `_`, `-`, neither `.` nor `..` (#574)
const SEGMENT = '(?!\\.{1,2}(?![\\w.-]))[A-Za-z0-9_.-]+';
const REFERENCE = new RegExp(`^(${SEGMENT}/${SEGMENT})#([1-9]\\d*)$`);
const REPOSITORY = new RegExp(`^${SEGMENT}/${SEGMENT}$`);
// a list item of `## Affected repos`
const AFFECTED = new RegExp(`^\\s*[-*]\\s+(?:\\[[ xX]\\]\\s+)?[\`\\[]*(${SEGMENT}/${SEGMENT})`);
const REQUIRES_LINE = /^[ \t]*(?:[-*][ \t]+)?Requires:(.*)$/gm;
const REQUIREMENT = new RegExp(
  `^(${SEGMENT}/${SEGMENT})(?:@(M\\d+(?:\\.\\d+)*)[ \\t]+(released|rc)|#([1-9]\\d*))$`,
);
// the version `github-milestone close` puts into the title: `M013 (1.2.0)`
const VERSION = /\((v?\d+\.\d+\.\d+[^()\s]*)\)\s*$/;
export const DEFERRED = 'deferred';
/** Labels that hold an item back: the loop never starts it (`Tracker.waitReason`, `planObjective`). */
export const HOLD_LABELS = ['needs-decision', 'needs-refinement', 'interactive', 'release-test'];

export type IssueRef = { repo: string; number: number };
export type Requirement = { repo: string } & (
  | { milestone: string; mode: 'released' | 'rc' }
  | { feature: number }
);
export type RequirementState = { state: 'met' } | { state: 'waiting'; reason: string };
export type Feature = TrackedIssue & {
  /** The Epic of the Objective the Feature comes from. */
  epic?: IssueRef;
  /** Labeled `deferred`: no work, the Objective is only partly released. */
  deferred: boolean;
  requires: Requirement[];
  /** The open PBIs and Bugs. */
  work: TrackedIssue[];
};
export type Objective = {
  objective: TrackedIssue;
  repositories: string[];
  requires: Requirement[];
  epics: TrackedIssue[];
  features: Feature[];
};

export function parseObjective(value: string): IssueRef {
  const match = REFERENCE.exec(value);
  if (!match) throw new Error('--objective is <owner>/<repo>#<nr>');
  return { repo: match[1] as string, number: Number(match[2]) };
}

/** `owner/name` with two valid segments. */
export const isRepository = (value: string): boolean => REPOSITORY.test(value);

export const isKind = (
  issue: { title: string; labels: (string | { name: string })[] },
  kind: string,
): boolean =>
  issue.title.toLowerCase().startsWith(`[${kind}]`) ||
  issue.labels.some(
    (label) => (typeof label === 'string' ? label : label.name).toLowerCase() === kind,
  );

/** The repositories of `## Affected repos`. */
export function affectedRepos(body: string): string[] {
  const section = /^##\s+Affected repos\s*$([\s\S]*?)(?=^##\s|(?![\s\S]))/im.exec(body)?.[1] ?? '';
  return section.split('\n').flatMap((line) => AFFECTED.exec(line)?.[1] ?? []);
}

/** The `Requires:` lines of a body. A line that is neither form, or names an invalid repository, is dropped. */
export function parseRequires(body: string): Requirement[] {
  // examples in comments and code blocks are no prerequisites
  const text = body.replace(/<!--[\s\S]*?-->|^[ \t]*```[\s\S]*?^[ \t]*```/gm, '');
  return [...text.matchAll(REQUIRES_LINE)].flatMap((line): Requirement[] => {
    const match = REQUIREMENT.exec((line[1] as string).replaceAll('`', '').trim());
    if (!match) return [];
    const [, repo = '', milestone, mode, feature] = match;
    return milestone
      ? [{ repo, milestone, mode: mode as 'released' | 'rc' }]
      : [{ repo, feature: Number(feature) }];
  });
}

/** `M013`, `M13 Topic (1.2.0)` and `M013 (1.2.0)` are the same milestone. */
export function milestoneKey(title: string): string | undefined {
  return /^M(\d+(?:\.\d+)*)(?!\S)/i.exec(title)?.[1]?.split('.').map(Number).join('.');
}

/** The milestone of a merged PBI is the release that shipped it (ADR 0010); it is released when its tag exists. */
function shipped(issue: TrackedIssue, reader: ObjectiveReader): boolean {
  const version = VERSION.exec(issue.milestone ?? '')?.[1]?.replace(/^v/, '');
  return !!version && [`v${version}`, version].some((tag) => reader.hasTag(issue.repo, tag));
}

/** Closed as completed: an issue closed as not planned or as a duplicate shipped nothing. */
const completed = (issue: TrackedIssue): boolean =>
  issue.state === 'closed' && !['not_planned', 'duplicate'].includes(issue.stateReason ?? '');

/** The Feature is closed and the release that shipped its last PBI or Bug is tagged. */
function featureReleased(ref: IssueRef, reader: ObjectiveReader): boolean {
  const feature = reader.issue(ref);
  if (!feature || !completed(feature)) return false;
  const last = reader
    .subIssues(ref)
    .filter((i) => completed(i) && (isKind(i, 'pbi') || isKind(i, 'bug')))
    .sort((a, b) => Date.parse(a.closedAt ?? '') - Date.parse(b.closedAt ?? ''))
    .pop();
  return !!last && shipped(last, reader);
}

/** Whether a `Requires:` line holds. `rc` counts as `released`. */
export function requirementState(req: Requirement, reader: ObjectiveReader): RequirementState {
  const met =
    'feature' in req
      ? featureReleased({ repo: req.repo, number: req.feature }, reader)
      : reader
          .milestones(req.repo)
          .some((m) => m.closed && milestoneKey(m.title) === milestoneKey(req.milestone));
  if (met) return { state: 'met' };
  const target = 'feature' in req ? `#${req.feature}` : `@${req.milestone}`;
  return { state: 'waiting', reason: `upstream ${req.repo}${target} not released` };
}

const same = (a: IssueRef, b: IssueRef): boolean =>
  a.number === b.number && a.repo.toLowerCase() === b.repo.toLowerCase();

/**
 * A native `blocked-by` into another repository holds when the Feature of the blocker is released. A blocker without
 * a Feature only has to be closed. When the blocked issue belongs to that same Feature, which cannot close before it,
 * the release of the blocker itself counts.
 */
export function blockerState(
  blocker: IssueRef,
  blocked: IssueRef,
  reader: ObjectiveReader,
): RequirementState {
  const waiting = (nr: number, repo: string): RequirementState => ({
    state: 'waiting',
    reason: `upstream ${repo}#${nr} not released`,
  });
  const issue = reader.issue(blocker);
  // not readable: nothing says it is released
  if (!issue) return waiting(blocker.number, blocker.repo);
  const feature = isKind(issue, 'feature') ? issue : reader.parent(blocker);
  if (!feature || !isKind(feature, 'feature'))
    return issue.state === 'closed' ? { state: 'met' } : waiting(blocker.number, blocker.repo);
  const own = reader.parent(blocked);
  if (own && same(own, feature))
    return completed(issue) && shipped(issue, reader)
      ? { state: 'met' }
      : waiting(blocker.number, blocker.repo);
  return requirementState({ repo: feature.repo, feature: feature.number }, reader);
}

/** The Objective `<owner>/<repo>#<nr>` with its native sub-issues in repositories of the same owner. */
export function readObjective(ref: string, reader: ObjectiveReader): Objective {
  const target = parseObjective(ref);
  const objective = reader.issue(target);
  if (!objective) throw new Error(`${ref} not found`);
  const owner = `${target.repo.split('/')[0]?.toLowerCase()}/`;
  // repository names are not case-sensitive: the first spelling wins
  const repositories = new Map<string, string>();
  // other owners are not part of an Objective
  const own = (repo: string): boolean => {
    const key = repo.toLowerCase();
    if (!key.startsWith(owner)) return false;
    if (!repositories.has(key)) repositories.set(key, repo);
    return true;
  };
  for (const repo of affectedRepos(objective.body)) own(repo);

  const epics: TrackedIssue[] = [];
  const features: Feature[] = [];
  const seen = new Set<string>();
  const walk = (parent: IssueRef, epic?: IssueRef): void => {
    for (const child of reader.subIssues(parent)) {
      const key = `${child.repo.toLowerCase()}#${child.number}`;
      if (!own(child.repo) || seen.has(key)) continue;
      seen.add(key);
      if (isKind(child, 'epic')) {
        epics.push(child);
        walk(child, { repo: child.repo, number: child.number });
      }
      if (!isKind(child, 'feature')) continue;
      const deferred = child.labels.some((label) => label.toLowerCase() === DEFERRED);
      features.push({
        ...child,
        ...(epic && { epic }),
        deferred,
        requires: parseRequires(child.body),
        work: deferred
          ? []
          : reader
              .subIssues(child)
              .filter(
                (i) => i.state === 'open' && (isKind(i, 'pbi') || isKind(i, 'bug')) && own(i.repo),
              ),
      });
    }
  };
  walk(target);

  return {
    objective,
    repositories: [...repositories.values()].sort((a, b) => a.localeCompare(b)),
    requires: parseRequires(objective.body),
    epics,
    features,
  };
}

/**
 * The open PBIs and Bugs below the Epic or Objective `ref` in the order the loop starts them: by the start order of
 * their repositories, then by number. Those of `deferred` Features are no work; `held` names the first `Requires:` line
 * of the Objective or the Feature that is not met.
 */
export function objectiveLeaves(
  ref: string,
  reader: ObjectiveReader,
): { issue: TrackedIssue; held?: string }[] {
  const read = readObjective(ref, reader);
  const order = startOrder(read).map((repo) => repo.toLowerCase());
  const rank = (issue: TrackedIssue) => order.indexOf(issue.repo.toLowerCase());
  const found = new Map<string, { issue: TrackedIssue; held?: string }>();
  for (const feature of read.features) {
    if (feature.work.length === 0) continue;
    let held: string | undefined;
    for (const requirement of [...read.requires, ...feature.requires]) {
      const state = requirementState(requirement, reader);
      if (state.state === 'met') continue;
      held = state.reason;
      break;
    }
    for (const issue of feature.work)
      found.set(`${issue.repo.toLowerCase()}#${issue.number}`, { issue, ...(held && { held }) });
  }
  return [...found.values()].sort(
    (a, b) => rank(a.issue) - rank(b.issue) || a.issue.number - b.issue.number,
  );
}

/** The wait reason of an issue from its native `blocked-by` links (the loop's `waitReason` and the plan share it). */
export function blockReason(
  blocked: IssueRef,
  blockers: (IssueRef & { state: string })[],
  reader: ObjectiveReader,
): string | undefined {
  const open = blockers.filter((b) => b.state === 'open');
  if (open.length > 0) return `blocked by ${open.map((b) => `${b.repo}#${b.number}`).join(', ')}`;
  // a closed blocker of another repository is not enough: its Feature must be released
  const upstream = blockers
    .filter((b) => b.repo.toLowerCase() !== blocked.repo.toLowerCase())
    .flatMap((b) => {
      const state = blockerState(b, blocked, reader);
      return state.state === 'waiting' ? [state.reason] : [];
    });
  return upstream.length > 0 ? [...new Set(upstream)].join(', ') : undefined;
}

/**
 * The order the repositories start in: after every repository that a Feature of them requires. Ties go by name; a
 * cycle starts its first repository by name.
 */
export function startOrder(objective: Objective): string[] {
  const repos = new Map(objective.repositories.map((repo) => [repo.toLowerCase(), repo]));
  const after = new Map<string, Set<string>>();
  for (const feature of objective.features) {
    const own = feature.repo.toLowerCase();
    for (const req of feature.requires) {
      const upstream = req.repo.toLowerCase();
      if (upstream !== own && repos.has(upstream))
        after.set(own, new Set([...(after.get(own) ?? []), upstream]));
    }
  }
  const order: string[] = [];
  const pending = [...repos.keys()];
  while (pending.length > 0) {
    const ready = pending.findIndex((key) =>
      [...(after.get(key) ?? [])].every((upstream) => order.includes(upstream)),
    );
    const [key] = pending.splice(Math.max(ready, 0), 1) as [string];
    order.push(key);
  }
  return order.map((key) => repos.get(key) as string);
}

/**
 * The plan of an Objective for `--objective --dry-run`: its repositories in start order and, per Feature, `deferred`
 * or the Feature's milestone with its open PBIs and Bugs. Each of those shows `ready` or every reason that holds it: a
 * hold label, an Objective or Feature `Requires:` not met, a `blocked-by` link. A Feature with no open PBI or Bug is a
 * gap. Reads only; nothing starts.
 */
export function planObjective(
  ref: string,
  reader: ObjectiveReader,
  /** The name of the token source of a repository's sessions and checkout. */
  tokenOf: (repo: string) => string,
): string[] {
  const read = readObjective(ref, reader);
  const waiting = (reqs: Requirement[]): string[] =>
    reqs.flatMap((req) => {
      const state = requirementState(req, reader);
      return state.state === 'waiting' ? [state.reason] : [];
    });
  const shared = waiting(read.requires);
  const order = startOrder(read);
  const lines = [
    `Objective ${ref} starts in: ${order.join(', ') || 'no repository'}`,
    `  requires: ${read.requires.length === 0 ? 'none' : shared.join(', ') || 'met'}`,
  ];
  for (const repo of order) {
    lines.push(repo, `  session token: ${tokenOf(repo)}`);
    const features = read.features.filter((f) => f.repo.toLowerCase() === repo.toLowerCase());
    if (features.length === 0) lines.push('  no Feature');
    for (const feature of features) {
      const name = `${feature.repo}#${feature.number}`;
      if (feature.deferred) {
        lines.push(`  feature ${name} deferred`);
        continue;
      }
      const closed = feature.state === 'closed';
      lines.push(
        `  feature ${name}${feature.milestone ? ` ${feature.milestone}` : ''}${closed ? ' closed' : ''}`,
      );
      if (!closed && feature.work.length === 0) lines.push('    gap: no open PBI or Bug');
      const featureWaits = waiting(feature.requires);
      for (const item of feature.work) {
        const itemRef = { repo: item.repo, number: item.number };
        const hold = item.labels.find((label) => HOLD_LABELS.includes(label));
        const blocked = blockReason(itemRef, reader.blockers(itemRef), reader);
        const reasons = [hold, ...shared, ...featureWaits, blocked].filter(
          (reason): reason is string => reason !== undefined,
        );
        lines.push(`    ${item.repo}#${item.number} ${reasons.join(', ') || 'ready'}`);
      }
    }
  }
  return lines;
}
