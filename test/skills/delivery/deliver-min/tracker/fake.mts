// A tracker for the tests of the deliver-min loop: the scenario comes from $FAKE_DIR/scenario.json, the
// pull request of an item exists once the fake harness wrote $FAKE_DIR/pr-<id>, and every merge is
// appended to $FAKE_DIR/calls.jsonl. The loop loads it through DELIVER_MIN_TRACKER_DIR.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import type {
  Gate,
  Item,
  Pull,
  Subject,
  Tracker,
} from '../../../../../skills/delivery/deliver-min/scripts/tracker.mts';

type Scenario = {
  items: { id: number; title: string; blockedBy?: number[] }[];
  /** One entry per gate() call, the last one repeats. `throw` is a failing tracker call. */
  gates?: (Gate | 'throw')[];
  files?: string[];
  /** The changed files from the second read on: a push after the session ended. */
  filesLater?: string[];
  required?: string[];
  needsDecision?: boolean;
  /** Every gate() call blocks this long, as a slow call of a real tracker does. */
  gateBlockMs?: number;
  /** A merged item stays listed (and keeps blocking) for this many items() calls, as a tracker that closes late. */
  closeAfterCalls?: number;
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
      };
    },
    gate(pull: Pull): Gate {
      if (merged.has(itemOf(pull))) return { state: 'merged' };
      if (scenario.gateBlockMs) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, scenario.gateBlockMs);
      }
      const gates = scenario.gates ?? [{ state: 'ready', reported: true, head: 'abc123' }];
      const gate = gates[Math.min(gateCalls, gates.length - 1)];
      gateCalls += 1;
      if (gate === 'throw') throw new Error('network down');
      return gate;
    },
    merge(pull: Pull, head: string): void {
      record({ call: 'merge', pull: pull.id, head });
      merged.add(itemOf(pull));
    },
    dropBranch: (pull: Pull) => record({ call: 'dropBranch', pull: pull.id }),
    requiredChecks: () => scenario.required ?? ['ci'],
    changedFiles(): string[] {
      fileReads += 1;
      const files = fileReads > 1 ? (scenario.filesLater ?? scenario.files) : scenario.files;
      return files ?? ['src/a.ts'];
    },
    sessionEnv: (token: string) => ({ GH_TOKEN: token }),
  };
}
