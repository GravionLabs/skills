// A tracker for the tests of the deliver loop: the scenario comes from $FAKE_DIR/scenario.json, the
// pull request of an item exists once the fake harness wrote $FAKE_DIR/pr-<id>, and every merge is
// appended to $FAKE_DIR/calls.jsonl. The loop loads it through DELIVER_TRACKER_DIR.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  BaseState,
  Gate,
  Item,
  Pull,
  Subject,
  Tracker,
} from '../../../../../skills/delivery/deliver/scripts/tracker.mts';

type Scenario = {
  items: { id: number; title: string; blockedBy?: number[] }[];
  /** One entry per gate() call, the last one repeats. `throw` is a failing tracker call. */
  gates?: (Gate | 'throw')[];
  files?: string[];
  /** The changed files from the second read on: a push after the session ended. */
  filesLater?: string[];
  /** The first this many reads of the changed files fail. */
  filesFailures?: number;
  /** `package.json` contents by commit: `base` is the merge base, `head` the commit that is judged (missing: no such file). */
  packageJson?: { base?: string; head?: string };
  /** The same for `Cargo.toml`. */
  cargoToml?: { base?: string; head?: string };
  /** The same for `pnpm-workspace.yaml`. */
  pnpmWorkspace?: { base?: string; head?: string };
  /** The same for `pyproject.toml`. */
  pyproject?: { base?: string; head?: string };
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
  /** One entry per baseState() call, the last one repeats. `throw` is a failing tracker call. */
  base?: ('green' | 'pending' | 'red' | 'throw')[];
  /** Items whose pull request is already merged before the loop starts the item. */
  mergedBefore?: number[];
  /** Items whose pull request is merged by someone else while their session runs. */
  mergedDuring?: number[];
  /** Items that have a second open pull request once their first one exists. */
  twoPulls?: number[];
};

export function create(): Tracker {
  const dir = String(process.env.FAKE_DIR);
  const scenario: Scenario = JSON.parse(readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
  const record = (call: Record<string, unknown>) =>
    appendFileSync(path.join(dir, 'calls.jsonl'), `${JSON.stringify(call)}\n`);
  const merged = new Set<number>();
  const closed = new Set<number>();
  const listedCalls = new Map<number, number>();
  let gateCalls = 0;
  let fileReads = 0;
  let baseCalls = 0;
  const itemOf = (pull: Pull) => pull.id - 100;

  return {
    name: 'fake',
    repo: 'fake/repo',
    subject: (): Subject => ({ kind: 'fake.repository', id: 'fake/repo', title: 'fake/repo' }),
    items: (): Item[] => {
      for (const id of merged) {
        const calls = (listedCalls.get(id) ?? 0) + 1;
        listedCalls.set(id, calls);
        if (calls > (scenario.closeAfterCalls ?? 0)) closed.add(id);
      }
      return scenario.items
        .filter((item) => !closed.has(item.id))
        .map((item) => ({
          id: item.id,
          title: item.title,
          url: `https://example.test/issues/${item.id}`,
          labels: ['pbi'],
          body: 'body of the issue',
        }));
    },
    itemSubject: (item: Item): Subject => ({
      kind: 'fake.issue',
      id: `fake/repo#${item.id}`,
      title: `#${item.id} ${item.title}`,
      url: item.url,
    }),
    waitReason(item: Item): string | undefined {
      const open = (scenario.items.find((i) => i.id === item.id)?.blockedBy ?? []).filter(
        (id) => !closed.has(id),
      );
      return open.length > 0 ? `blocked by ${open.map((id) => `#${id}`).join(', ')}` : undefined;
    },
    needsDecision: () => scenario.needsDecision ?? false,
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
      record({ call: 'merge', pull: pull.id, head });
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
      return {
        id: 900,
        title: '[Bug] fix: release/next is red (ci)',
        url: 'https://example.test/issues/900',
        labels: ['bug'],
        body: 'body of the bug',
      };
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
    compareRefs: (_pull: Pull, head?: string) => ({ base: 'base-sha', head: head ?? 'head-sha' }),
    fileAt(sha: string, file: string): string | undefined {
      const contents = /cargo\.toml$/i.test(file)
        ? scenario.cargoToml
        : /pnpm-workspace\.yaml$/i.test(file)
          ? scenario.pnpmWorkspace
          : /pyproject\.toml$/i.test(file)
            ? scenario.pyproject
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
    ensureReleasePull(): Pull {
      record({ call: 'releasePull' });
      return {
        id: 900,
        title: 'release: release/next',
        url: 'https://example.test/pull/900',
        branch: 'release/next',
      };
    },
    sessionEnv: (token: string) => ({ GH_TOKEN: token }),
  };
}
