// A tracker for the tests of the deliver loop: the scenario comes from $FAKE_DIR/scenario.json, the
// pull request of an item exists once the fake harness wrote $FAKE_DIR/pr-<id>, and every merge is
// appended to $FAKE_DIR/calls.jsonl. The loop loads it through DELIVER_TRACKER_DIR.
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  BaseState,
  Gate,
  Item,
  ObjectiveReader,
  Pull,
  Subject,
  Tracker,
  TrackedIssue,
  TrackerContext,
} from '../../../../../skills/delivery/deliver/scripts/tracker.mts';
import {
  blockerState,
  parseObjective,
} from '../../../../../skills/delivery/deliver/scripts/objective.mts';

/** An issue of `repositories`. `subIssues`: numbers of the same repository or `owner/repo#n`. */
export type FakeIssue = Partial<Omit<TrackedIssue, 'repo' | 'url'>> & {
  number: number;
  title: string;
  subIssues?: (number | string)[];
  /** Native `blocked-by` links: numbers of the same repository or `owner/repo#n`. */
  blockedBy?: (number | string)[];
  /** Not an item of a unit before the item of this number is closed: an issue added during the run. */
  addedAfter?: number;
};

export type Scenario = {
  /** `blockedBy`: ids of items, or `owner/repo#n` of an issue of `repositories`. */
  items: {
    id: number;
    title: string;
    body?: string;
    blockedBy?: (number | string)[];
    feature?: number;
  }[];
  /** By `owner/repo`: what `readObjective` reads. A release is its milestone and its tag. */
  repositories?: Record<
    string,
    { issues?: FakeIssue[]; milestones?: { title: string; closed: boolean }[]; tags?: string[] }
  >;
  /** One entry per gate() call, the last one repeats. `throw` is a failing tracker call. */
  gates?: (Gate | 'throw')[];
  files?: string[];
  /** The changed files from the second read on: a push after the session ended. */
  filesLater?: string[];
  /** The first this many reads of the changed files fail. */
  filesFailures?: number;
  /** `.agents/config.json` by commit, as the guard gate reads it (missing: no such file; `throw`: a failing read). */
  projectConfig?: { base?: string; head?: string } | 'throw';
  /** The base branch of `pullRequest()`, one entry per call, the last one repeats: a retarget while a gate runs. */
  pullBases?: string[];
  /** Every merge() call throws this message, as a tracker that refuses the merge. */
  mergeRefused?: string;
  /** The head of the pull request from this compareRefs() call on (1-based): a push while the guard reads. */
  pushedAtCompare?: number;
  /** `package.json` contents by commit: `base` is the merge base, `head` the commit that is judged (missing: no such file). */
  packageJson?: { base?: string; head?: string };
  /** The same for `Cargo.toml`. */
  cargoToml?: { base?: string; head?: string };
  /** The same for `pnpm-workspace.yaml`. */
  pnpmWorkspace?: { base?: string; head?: string };
  /** The same for `pyproject.toml`. */
  pyproject?: { base?: string; head?: string };
  /** The same for `go.mod`. */
  goMod?: { base?: string; head?: string };
  /** The same for `Directory.Packages.props`. */
  packagesProps?: { base?: string; head?: string };
  required?: string[];
  needsDecision?: boolean;
  /** Every gate() call blocks this long, as a slow call of a real tracker does. */
  gateBlockMs?: number;
  /** Every gate() call sends the stop request (SIGINT) to the loop from inside the call, as a Ctrl-C during a slow call. */
  stopInGate?: boolean;
  /** Every changedFiles() call sends the stop request, as stopInGate does for gate(). */
  stopInChangedFiles?: boolean;
  /** A merged item stays listed (and keeps blocking) for this many items() calls, as a tracker that closes late. */
  closeAfterCalls?: number;
  /** Open release-test issues of the milestone. */
  releaseTests?: number[];
  /** Commits of the base branch beyond the default branch, default 1. */
  releaseCommits?: number;
  /** Open pull requests into the base branch that are not of the milestone. */
  foreignPulls?: { id: number; title: string; url: string; branch: string }[];
  /** One entry per baseState() call, the last one repeats. `throw` is a failing tracker call. */
  base?: ('green' | 'pending' | 'red' | 'throw')[];
  /** Items whose pull request is already merged before the loop starts the item. */
  mergedBefore?: number[];
  /** Items whose pull request is merged by someone else while their session runs. */
  mergedDuring?: number[];
  /** The milestone has a Feature (default true). */
  retroFeature?: boolean;
  /** The parent Feature by item id. */
  features?: Record<number, { title: string; body: string }>;
  /** Items that have a second open pull request once their first one exists. */
  twoPulls?: number[];
  /** Repositories whose release pull request is merged and tagged at once: its milestone closes (`released.jsonl`). */
  releaseOnPull?: string[];
};

export function create({ selection, repo: named, base }: TrackerContext): Tracker {
  const dir = String(process.env.FAKE_DIR);
  // a unit of an Objective run names its repository: its items come from `repositories`
  const repo = named ?? 'fake/repo';
  if (named)
    appendFileSync(path.join(dir, 'units.jsonl'), `${JSON.stringify({ repo, selection })}\n`);
  else writeFileSync(path.join(dir, 'selection.json'), JSON.stringify(selection));
  // like the GitHub tracker: the Bug of a red base is one of the items from its filing until it is merged
  let baseBug: Item | undefined;
  const scenario: Scenario = JSON.parse(readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
  const record = (call: Record<string, unknown>) =>
    appendFileSync(path.join(dir, 'calls.jsonl'), `${JSON.stringify(call)}\n`);
  const merged = new Set<number>();
  const closed = new Set<number>();
  // a second run of an Objective on the same $FAKE_DIR: what an earlier run merged stays closed, and the stages it
  // wrote are the labels of the items
  const earlier = (file: string): Record<string, unknown>[] =>
    existsSync(path.join(dir, file))
      ? readFileSync(path.join(dir, file), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
          .filter((line) => named !== undefined && line.repo === named)
      : [];
  for (const call of earlier('calls.jsonl'))
    if (call.call === 'merge') {
      merged.add(Number(call.pull) - 100);
      closed.add(Number(call.pull) - 100);
    }
  const stageLabels = (id: number): string[] => {
    const stage = earlier('stages.jsonl')
      .filter((line) => line.id === id)
      .at(-1)?.stage;
    return stage ? [`agent:${stage}`] : [];
  };
  const listedCalls = new Map<number, number>();
  let gateCalls = 0;
  let fileReads = 0;
  let compareCalls = 0;
  let baseCalls = 0;
  let pullReads = 0;
  const itemOf = (pull: Pull) => pull.id - 100;

  const repository = (name: string) => scenario.repositories?.[name];
  const readLines = (file: string): Record<string, unknown>[] =>
    existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  const refOf = (repo: string, value: number | string) =>
    typeof value === 'number' ? { repo, number: value } : parseObjective(value);
  const tracked = (repo: string, issue: FakeIssue): TrackedIssue => {
    const { subIssues: _, ...fields } = issue;
    return {
      body: '',
      labels: [],
      state: 'open',
      ...fields,
      repo,
      url: `https://example.test/${repo}/issues/${issue.number}`,
    };
  };
  const reader: ObjectiveReader = {
    issue(ref) {
      const issue = repository(ref.repo)?.issues?.find((i) => i.number === ref.number);
      return issue && tracked(ref.repo, issue);
    },
    parent(ref) {
      for (const [repo, { issues = [] }] of Object.entries(scenario.repositories ?? {})) {
        const parent = issues.find((i) =>
          i.subIssues?.some((value) => {
            const child = refOf(repo, value);
            return child.repo === ref.repo && child.number === ref.number;
          }),
        );
        if (parent) return tracked(repo, parent);
      }
      return undefined;
    },
    subIssues(ref) {
      const issue = repository(ref.repo)?.issues?.find((i) => i.number === ref.number);
      return (issue?.subIssues ?? []).flatMap(
        (value) => reader.issue(refOf(ref.repo, value)) ?? [],
      );
    },
    milestones: (name) =>
      (repository(name)?.milestones ?? []).map((m) => ({
        ...m,
        closed:
          m.closed ||
          readLines(path.join(dir, 'released.jsonl')).some(
            (r) => r.repo === name && r.milestone === m.title,
          ),
      })),
    hasTag: (repo, tag) => repository(repo)?.tags?.includes(tag) ?? false,
    blockers(ref) {
      const issue = repository(ref.repo)?.issues?.find((i) => i.number === ref.number);
      return (issue?.blockedBy ?? []).map((value) => {
        const blocker = refOf(ref.repo, value);
        return { ...blocker, state: reader.issue(blocker)?.state ?? 'open' };
      });
    },
  };

  const isWork = (issue: FakeIssue) =>
    (issue.state ?? 'open') === 'open' &&
    (issue.labels ?? []).some((label) => label === 'pbi' || label === 'bug');
  /** The open PBIs and Bugs of the unit: in its milestone or below its Feature (or the open Features of its milestone). */
  const unitIssues = (): FakeIssue[] => {
    const issues = repository(repo)?.issues ?? [];
    const below = (feature: FakeIssue) =>
      (feature.subIssues ?? []).flatMap((value) =>
        typeof value === 'number' ? issues.filter((i) => i.number === value) : [],
      );
    const features = selection.feature
      ? issues.filter((i) => i.number === Number(selection.feature))
      : issues.filter(
          (i) =>
            i.milestone === selection.milestone &&
            i.title.startsWith('[Feature]') &&
            (i.state ?? 'open') === 'open' &&
            !(selection.skipDeferred && i.labels?.includes('deferred')),
        );
    const direct = selection.feature
      ? []
      : issues.filter((i) => i.milestone === selection.milestone);
    const found = new Map<number, FakeIssue>();
    for (const issue of [...direct, ...features.flatMap(below)])
      if (isWork(issue) && (issue.addedAfter === undefined || closed.has(issue.addedAfter)))
        found.set(issue.number, issue);
    return [...found.values()].sort((a, b) => a.number - b.number);
  };
  const listed = (): Scenario['items'] =>
    named
      ? unitIssues().map((i) => ({ id: i.number, title: i.title, body: i.body }))
      : scenario.items;

  return {
    name: 'fake',
    repo,
    ...reader,
    subject: (): Subject => ({ kind: 'fake.repository', id: repo, title: repo }),
    items: (): Item[] => {
      for (const id of merged) {
        const calls = (listedCalls.get(id) ?? 0) + 1;
        listedCalls.set(id, calls);
        if (calls > (scenario.closeAfterCalls ?? 0)) closed.add(id);
      }
      return listed()
        .filter((item) => !closed.has(item.id))
        .map((item) => ({
          id: item.id,
          title: item.title,
          url: `https://example.test/issues/${item.id}`,
          labels: ['pbi', ...stageLabels(item.id)],
          body: item.body ?? 'body of the issue',
          ...(item.feature && { feature: item.feature }),
        }))
        .concat(baseBug && !closed.has(baseBug.id) ? [baseBug] : []);
    },
    itemSubject: (item: Item): Subject => ({
      kind: 'fake.issue',
      id: `fake/repo#${item.id}`,
      title: `#${item.id} ${item.title}`,
      url: item.url,
    }),
    waitReason(item: Item): string | undefined {
      const blockers = scenario.items.find((i) => i.id === item.id)?.blockedBy ?? [];
      const open = blockers.filter((id) => typeof id === 'number' && !closed.has(id));
      if (open.length > 0) return `blocked by ${open.map((id) => `#${id}`).join(', ')}`;
      for (const value of blockers.filter((b) => typeof b === 'string')) {
        const blocked = { repo: 'fake/repo', number: item.id };
        const state = blockerState(parseObjective(value), blocked, reader);
        if (state.state === 'waiting') return state.reason;
      }
      return undefined;
    },
    needsDecision: () => scenario.needsDecision ?? false,
    parentFeature(item: Item): Item | undefined {
      const feature = scenario.features?.[item.id];
      return (
        feature && {
          ...feature,
          id: 1,
          url: 'https://example.test/issues/1',
          labels: ['feature'],
        }
      );
    },
    setStage: (item: Item, stage?: string) =>
      appendFileSync(
        path.join(dir, 'stages.jsonl'),
        `${JSON.stringify({ id: item.id, stage: stage ?? null, repo: named })}\n`,
      ),
    syncStageLabels: () => {
      if (named) record({ call: 'syncStageLabels', repo });
      return [];
    },
    removeLabel: (item: Item, label: string) => {
      if (label.startsWith('agent:')) throw new Error(`refused: ${label}`);
      record({ call: 'removeLabel', id: item.id, label, repo: named });
    },
    rerunJob: (job: number) => record({ call: 'rerunJob', job, repo: named }),
    commentOnce: (item: Item, marker: string, body: string) =>
      appendFileSync(
        path.join(dir, 'comments.jsonl'),
        `${JSON.stringify({ id: item.id, marker, body })}\n`,
      ),
    recordVerdict: () => {},
    recordedVerdicts: () => [],
    pullOf(item: Item): Pull | undefined {
      if (!existsSync(path.join(dir, `pr-${item.id}`))) return undefined;
      const id = 100 + item.id;
      return {
        id,
        title: item.title,
        url: `https://example.test/pull/${id}`,
        branch: `feat/${item.id}-fake`,
        ...((scenario.twoPulls ?? []).includes(item.id) && {
          others: [`https://example.test/pull/${id + 50}`],
        }),
      };
    },
    mergedPullOf(item: Item): Pull | undefined {
      const sessions = path.join(dir, 'sessions.jsonl');
      const started =
        existsSync(sessions) &&
        readFileSync(sessions, 'utf8')
          .split('\n')
          .some((line) => line && JSON.parse(line).id === item.id);
      const isMerged =
        (scenario.mergedBefore ?? []).includes(item.id) ||
        ((scenario.mergedDuring ?? []).includes(item.id) && started);
      if (!isMerged) return undefined;
      return {
        id: 100 + item.id,
        title: item.title,
        url: `https://example.test/pull/${100 + item.id}`,
        branch: `feat/${item.id}-fake`,
      };
    },
    pullRequest(id: number): { pull: Pull; base: string } {
      const reads = (pullReads += 1);
      const bases = scenario.pullBases ?? ['release/next'];
      return {
        pull: {
          id,
          title: `fake #${id}`,
          url: `https://example.test/pull/${id}`,
          branch: `feat/${id}-fake`,
        },
        base: bases[Math.min(reads - 1, bases.length - 1)],
      };
    },
    gate(pull: Pull): Gate {
      if (merged.has(itemOf(pull))) return { state: 'merged' };
      if (scenario.gateBlockMs) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, scenario.gateBlockMs);
      }
      if (scenario.stopInGate) {
        process.kill(process.pid, 'SIGINT');
        // the kernel delivers a signal to its own process asynchronously: wait until the handler has queued it
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      }
      const gates = scenario.gates ?? [{ state: 'ready', reported: true, head: 'abc123' }];
      const gate = gates[Math.min(gateCalls, gates.length - 1)];
      gateCalls += 1;
      if (gate === 'throw') throw new Error('network down');
      // merged by a person: the item closes like after a merge of the loop
      if (gate.state === 'merged') merged.add(itemOf(pull));
      return gate;
    },
    merge(pull: Pull, head: string): void {
      if (scenario.mergeRefused) throw new Error(scenario.mergeRefused);
      record({ call: 'merge', pull: pull.id, head, repo: named });
      // what a merge depends on beside the commit: the base branch of the tracker (method, required checks) and the title
      appendFileSync(
        path.join(dir, 'merges.jsonl'),
        `${JSON.stringify({ pull: pull.id, head, base, title: pull.title })}\n`,
      );
      merged.add(itemOf(pull));
    },
    dropBranch: (pull: Pull) => record({ call: 'dropBranch', pull: pull.id }),
    requiredChecks: () => scenario.required ?? ['ci'],
    baseState(): BaseState {
      const states = scenario.base ?? ['green'];
      const state = states[Math.min(baseCalls, states.length - 1)];
      baseCalls += 1;
      if (state === 'throw') throw new Error('network down');
      return {
        state,
        failed: state === 'red' ? [{ name: 'ci', url: 'https://example.test/runs/1' }] : [],
      };
    },
    rerunFailed: () => record({ call: 'rerun' }),
    reportBaseRed(): Item {
      record({ call: 'baseBug' });
      baseBug = {
        id: 900,
        title: '[Bug] fix: release/next is red (ci)',
        url: 'https://example.test/issues/900',
        labels: ['bug'],
        body: 'body of the bug',
      };
      return baseBug;
    },
    changedFiles(): string[] {
      if (scenario.stopInChangedFiles) {
        process.kill(process.pid, 'SIGINT');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
      }
      fileReads += 1;
      if (fileReads <= (scenario.filesFailures ?? 0)) throw new Error('HTTP 500');
      const reads = fileReads - (scenario.filesFailures ?? 0);
      const files = reads > 1 ? (scenario.filesLater ?? scenario.files) : scenario.files;
      return files ?? ['src/a.ts'];
    },
    // `abc123` is a tag of the fixture repository: the loop checks the head out for the review
    compareRefs: (_pull: Pull, head?: string) => {
      compareCalls++;
      const current =
        scenario.pushedAtCompare && compareCalls >= scenario.pushedAtCompare ? 'def456' : 'abc123';
      return { base: 'base-sha', head: head ?? current };
    },
    fileAt(sha: string, file: string): string | undefined {
      if (file === '.agents/config.json') {
        if (scenario.projectConfig === 'throw') throw new Error('HTTP 500');
        return sha === 'base-sha' ? scenario.projectConfig?.base : scenario.projectConfig?.head;
      }
      const contents = /cargo\.toml$/i.test(file)
        ? scenario.cargoToml
        : /pnpm-workspace\.yaml$/i.test(file)
          ? scenario.pnpmWorkspace
          : /pyproject\.toml$/i.test(file)
            ? scenario.pyproject
            : /go\.mod$/i.test(file)
              ? scenario.goMod
              : /directory\.packages\.props$/i.test(file)
                ? scenario.packagesProps
                : scenario.packageJson;
      if (!contents) throw new Error('HTTP 500');
      return sha === 'base-sha' ? contents.base : contents.head;
    },
    defaultBranch: () => 'main',
    releaseTests: (): Item[] =>
      (scenario.releaseTests ?? []).map((id) => ({
        id,
        title: '[PBI] test: release candidate',
        url: `https://example.test/issues/${id}`,
        labels: ['release-test'],
        body: '',
      })),
    releaseCommits: () => scenario.releaseCommits ?? 1,
    foreignPulls: (): Pull[] => scenario.foreignPulls ?? [],
    ensureReleasePull(): Pull {
      record({ call: 'releasePull', repo });
      if (scenario.releaseOnPull?.includes(repo))
        appendFileSync(
          path.join(dir, 'released.jsonl'),
          `${JSON.stringify({ repo, milestone: selection.milestone })}\n`,
        );
      return {
        id: 900,
        title: 'release: release/next',
        url: 'https://example.test/pull/900',
        branch: 'release/next',
      };
    },
    hasRetroFeature: () => scenario.retroFeature ?? true,
    isRetroComment: (url: string, marker: string) =>
      existsSync(path.join(dir, 'retro.json')) &&
      JSON.parse(readFileSync(path.join(dir, 'retro.json'), 'utf8'))[url]?.startsWith(marker) ===
        true,
    linkRetro: (pull: Pull, url: string) => record({ call: 'linkRetro', pull: pull.id, url }),
    sessionEnv: (token: string) => ({ GH_TOKEN: token }),
  };
}
