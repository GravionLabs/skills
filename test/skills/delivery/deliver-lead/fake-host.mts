// A scripted host for the step script of deliver-lead: it answers each action from a scenario, as an adapter of
// host-verbs.md would, and makes each worker do its part over the fake tracker of the loop tests ($FAKE_DIR): the
// implementer opens the pull request (`pr-<issue>`) and writes its result file, the reviewer writes its verdict
// file for the commit it was started at.
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
  /** Implementer: no pull request is opened. */
  noPull?: boolean;
  /** Implementer: the risk level of its result file (default `low`). */
  risk?: string;
  /** Reviewer: the verdict it writes (default `approve`). */
  verdict?: 'approve' | 'changes';
};
export type HostScenario = { implementer?: WorkerScript; reviewer?: WorkerScript };

type Start = Extract<Action, { do: 'start-worker' }>;

/** Runs the lead until it ends: `step` is one call of the step script with the outcome of the previous verb. */
export async function runLead(
  step: (result: StepResult | undefined) => Promise<Action>,
  { fakeDir, issue, scenario = {}, max = 20 }: {
    fakeDir: string;
    issue: number;
    scenario?: HostScenario;
    max?: number;
  },
  /** Called after each action with the call that returns it again (a repeated call); a test checks it. */
  onRepeat?: (action: Action, again: () => Promise<Action>) => Promise<void>,
): Promise<{ actions: Action[]; report: Report }> {
  const workers = new Map<string, Start>();
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
      workers.set(handle, action);
      result = { handle };
    } else if (action.do === 'wait-any') {
      const handle = action.handles[0]!;
      const worker = workers.get(handle)!;
      const script = scenario[worker.role] ?? {};
      const state = script.state ?? 'done';
      if (state === 'done') work(worker, script, fakeDir, issue);
      result = { handle, state, ...(state === 'blocked' && { question: 'which option?' }) };
    } else {
      const report = path.join(fakeDir, `${action.handle}.report.md`);
      writeFileSync(report, `outcome: succeeded\n`);
      result = { handle: action.handle, report };
    }
  }
  throw new Error(`no end after ${max} actions`);
}

function work(worker: Start, script: WorkerScript, fakeDir: string, issue: number): void {
  if (worker.role === 'implementer') {
    if (!script.noPull) writeFileSync(path.join(fakeDir, `pr-${issue}`), '');
    const file = worker.env.DELIVER_RESULT_FILE!;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ risk: { level: script.risk ?? 'low' } }));
    return;
  }
  const verdict = script.verdict ?? 'approve';
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
