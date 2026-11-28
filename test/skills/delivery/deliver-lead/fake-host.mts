// A scripted host for the step script of deliver-lead: it answers each action from a scenario, as an adapter of
// host-verbs.md would, and makes each worker do its part over the fake tracker of the loop tests ($FAKE_DIR): the
// implementer opens the pull request (`pr-<issue>`) and writes its result file, a later implementer (a fix round or
// a restart) pushes a new head (`head-<pull>`, read by a `shared` fake tracker), the reviewer writes its verdict file
// for the commit it was started at.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  Action,
  Report,
  StepResult,
} from '../../../../skills/delivery/deliver-lead/scripts/leaf.mts';

/** What one worker does: its final state (default `done`) and its file. */
export type WorkerScript = {
  state?: StepResult['state'];
  /** Blocked first: the lead's answer to its question; after `sent` the worker finishes as `state` says. */
  blocked?: 'sent' | 'owner';
  /** Blocked: its question (default `which option?`). */
  question?: string;
  /** Implementer: writes no result file. */
  noResult?: boolean;
  /** Blocked: it asks again after every answer, each time after this many seconds. */
  asksAgainAfter?: number;
  /** Implementer: no pull request is opened. */
  noPull?: boolean;
  /** Implementer: the risk level of its result file (default `low`). */
  risk?: string;
  /** Reviewer: the verdict it writes (default `approve`); `none` writes no file. */
  verdict?: 'approve' | 'changes' | 'none';
};
/** Per role one script, or one per start of that role (the last one repeats). */
export type HostScenario = {
  implementer?: WorkerScript | WorkerScript[];
  reviewer?: WorkerScript | WorkerScript[];
  /** The text of every final report: a claim the flow must not act on. */
  report?: string;
};

type Start = Extract<Action, { do: 'start-worker' }>;

/** Runs the lead until it ends: `step` is one call of the step script with the outcome of the previous verb. */
export async function runLead(
  step: (result: StepResult | undefined) => Promise<Action>,
  {
    fakeDir,
    issue,
    scenario = {},
    max = 40,
    onWait,
  }: {
    fakeDir: string;
    issue: number;
    scenario?: HostScenario;
    max?: number;
    /** A wait without handles: the host lets `timeout` seconds pass. */
    onWait?: (timeout: number) => void;
  },
  /** Called after each action with the call that returns it again (a repeated call); a test checks it. */
  onRepeat?: (action: Action, again: () => Promise<Action>) => Promise<void>,
): Promise<{ actions: Action[]; report: Report }> {
  const workers = new Map<string, { start: Start; script: WorkerScript; blocked: boolean }>();
  const starts = { implementer: 0, reviewer: 0 };
  const actions: Action[] = [];
  let result: StepResult | undefined;
  for (let i = 0; i < max; i++) {
    const answered = result;
    const action = await step(answered);
    actions.push(action);
    await onRepeat?.(action, () => step(answered));
    if (action.do === 'end') return { actions, report: action.report };
    if (action.do === 'start-worker') {
      const handle = `w${workers.size + 1}-${action.role}`;
      const scripts = [scenario[action.role] ?? {}].flat();
      const script = scripts[Math.min(starts[action.role], scripts.length - 1)]!;
      starts[action.role] += 1;
      workers.set(handle, { start: action, script, blocked: script.blocked !== undefined });
      result = { handle, name: action.name };
    } else if (action.do === 'wait-any') {
      if (action.handles.length === 0) {
        onWait?.(action.timeout);
        result = { state: 'timeout' };
        continue;
      }
      const handle = action.handles[0]!;
      const worker = workers.get(handle)!;
      if (worker.blocked) {
        if (worker.script.asksAgainAfter) onWait?.(worker.script.asksAgainAfter);
        result = { handle, state: 'blocked', question: worker.script.question ?? 'which option?' };
        continue;
      }
      const state = worker.script.state ?? 'done';
      // a worker that does not finish lets the whole wait pass
      if (state === 'timeout') onWait?.(action.timeout);
      if (state === 'done') work(worker.start, worker.script, fakeDir, issue, starts.implementer);
      result = { handle, state };
    } else if (action.question !== undefined) {
      const worker = workers.get(action.handle)!;
      worker.blocked = worker.script.asksAgainAfter !== undefined;
      result = { handle: action.handle, answer: worker.script.blocked, question: action.question };
    } else {
      const report = path.join(fakeDir, `${action.handle}.report.md`);
      writeFileSync(report, scenario.report ?? `outcome: succeeded\n`);
      result = { handle: action.handle, report };
    }
  }
  throw new Error(`no end after ${max} actions`);
}

function work(
  worker: Start,
  script: WorkerScript,
  fakeDir: string,
  issue: number,
  implementers: number,
): void {
  if (worker.role === 'implementer') {
    if (!script.noPull) writeFileSync(path.join(fakeDir, `pr-${issue}`), '');
    // a later implementer pushes to the pull request
    if (implementers > 1)
      writeFileSync(path.join(fakeDir, `head-${100 + issue}`), `fade0${implementers}`);
    if (script.noResult) return;
    const file = worker.env.DELIVER_RESULT_FILE!;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ risk: { level: script.risk ?? 'low' } }));
    return;
  }
  const verdict = script.verdict ?? 'approve';
  if (verdict === 'none') return;
  const file = worker.env.DELIVER_REVIEW_FILE!;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(
    file,
    JSON.stringify({
      verdict,
      findings:
        verdict === 'changes' ? [{ severity: 'blocking', file: 'src/a.ts', summary: 'bug' }] : [],
      unmet: [],
      head: worker.head,
    }),
  );
}
