// The contract between the deliver loop and an issue tracker. The loop knows nothing else about
// GitHub, Azure DevOps or any other system: it asks for the next work item, finds its pull request,
// reads the gate of the merge and merges. A tracker is the file tracker/<name>.mts, chosen by
// `deliver.tracker` in .agents/config.json (default `github`), and exports `create(context)`.

import path from 'node:path';
import { pathToFileURL } from 'node:url';

/** What a reader of the run sees: a milestone, an issue, a repository. */
export type Subject = { kind: string; id: string; title: string; url?: string };

/** `body` is the text the session works from: the loop hands it over, the session does not fetch it. */
export type Item = { id: number; title: string; url: string; labels: string[]; body: string };

export type Pull = { id: number; title: string; url: string; branch: string };

/**
 * Where a pull request stands on its way to the merge.
 * `ready`: every required check has reported and is green, and nothing conflicts; `head` is the commit
 * that was checked. The tracker decides this from the checks themselves, never from whether the merge
 * would be accepted. `reported` tells whether any check has reported yet, because checks register a
 * moment after the pull request opens.
 */
export type Gate =
  | { state: 'merged' | 'closed' }
  | { state: 'conflict' | 'red'; detail: string }
  | { state: 'pending'; reported: boolean; head?: string }
  | { state: 'ready'; reported: boolean; head: string };

export type Selection = { milestone?: string; issues?: string[] };

export type TrackerContext = {
  /** The checkout the loop runs in. */
  cwd: string;
  /** The branch the pull requests go into. */
  base: string;
  selection: Selection;
  /** Deliver items of any author. Default: only authors with write access, whose text nobody else can change. */
  trustAuthors: boolean;
};

export interface Tracker {
  /** `github`, `ado`, … Names the subject kinds (`github.issue`). */
  readonly name: string;
  /** The repository as the tracker names it, for example `GravionLabs/poimen`. */
  readonly repo: string;
  /** What the whole run delivers: the milestone, or the repository for a list of issues. */
  subject(): Subject;
  /** The open work items of the selection in delivery order. */
  items(): Item[];
  itemSubject(item: Item): Subject;
  /** Why the item cannot start now (a hold label, an open blocker, an author without write access), else nothing. */
  waitReason(item: Item): string | undefined;
  /** The session asked a question instead of delivering. */
  needsDecision(item: Item): boolean;
  /** The open pull request of the item, found by its branch `<type>/<id>-…`. */
  pullOf(item: Item): Pull | undefined;
  gate(pull: Pull): Gate;
  /** Squash-merges exactly the commit `head`. Throws an Error whose message is the reason when the tracker refuses. */
  merge(pull: Pull, head: string): void;
  /** Removes the branch of a merged pull request on the remote. */
  dropBranch(pull: Pull): void;
  /** The checks the base branch requires before a merge. None: the tracker does not guard the merge. */
  requiredChecks(): string[];
  /** The paths the pull request changes, a rename with both names. */
  changedFiles(pull: Pull): string[];
  /** The branch the release goes into (`main`), where a missing base branch is cut from. */
  defaultBranch(): string;
  /** The open `release-test` issues of the selection: a person tests the release candidate, the loop never starts them. */
  releaseTests(): Item[];
  /** The open release pull request from the base branch into the default branch; opens it when missing. Never merges it. */
  ensureReleasePull(): Pull;
  /** The environment that makes a session act with `token` instead of the login of the user. */
  sessionEnv(token: string): Record<string, string>;
}

export async function loadTracker(name: string, context: TrackerContext): Promise<Tracker> {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error(`invalid tracker name: ${name}`);
  // Tests only: a directory from the environment of the user that holds the tracker file.
  const dir = process.env.DELIVER_TRACKER_DIR;
  const file = dir
    ? pathToFileURL(path.join(dir, `${name}.mts`))
    : new URL(`./tracker/${name}.mts`, import.meta.url);
  const module = await import(file.href);
  return module.create(context);
}
