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
  required?: string[];
};

export function create(): Tracker {
  const dir = String(process.env.FAKE_DIR);
  const scenario: Scenario = JSON.parse(readFileSync(path.join(dir, 'scenario.json'), 'utf8'));
  const record = (call: Record<string, unknown>) =>
    appendFileSync(path.join(dir, 'calls.jsonl'), `${JSON.stringify(call)}\n`);
  const merged = new Set<number>();
  let gateCalls = 0;
  const itemOf = (pull: Pull) => pull.id - 100;

  return {
    name: 'fake',
    repo: 'fake/repo',
    subject: (): Subject => ({ kind: 'fake.repository', id: 'fake/repo', title: 'fake/repo' }),
    items: (): Item[] =>
      scenario.items
        .filter((item) => !merged.has(item.id))
        .map((item) => ({
          id: item.id,
          title: item.title,
          url: `https://example.test/issues/${item.id}`,
          labels: ['pbi'],
          body: 'body of the issue',
        })),
    itemSubject: (item: Item): Subject => ({
      kind: 'fake.issue',
      id: `fake/repo#${item.id}`,
      title: `#${item.id} ${item.title}`,
      url: item.url,
    }),
    waitReason(item: Item): string | undefined {
      const open = (scenario.items.find((i) => i.id === item.id)?.blockedBy ?? []).filter(
        (id) => !merged.has(id),
      );
      return open.length > 0 ? `blocked by ${open.map((id) => `#${id}`).join(', ')}` : undefined;
    },
    needsDecision: () => false,
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
    changedFiles: () => scenario.files ?? ['src/a.ts'],
    sessionEnv: (token: string) => ({ GH_TOKEN: token }),
  };
}
