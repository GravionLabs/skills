// The leaf driver of deliver-loop (#1194, `deliver.leafFlow` `step`): it asks the step script of deliver-lead
// (`leafStep`) for the next action of one PBI or Bug, executes that host verb and hands the outcome back unchanged,
// until the step script ends. The order of the flow lives in `leafStep` only: the driver never decides, retries,
// skips or reorders an action and calls no gate (references/orchestration.md, Leaf driver).
import type { Action, Report, StepResult } from '../../deliver-lead/scripts/leaf.mts';
import type { VerbResult, WorkerStart } from './process-host.mts';

/** The verbs of references/host-verbs.md, as a host implements them. */
export type DriverHost = {
  startWorker(start: WorkerStart): Promise<VerbResult>;
  waitAny(handles: string[], timeout: number): Promise<VerbResult>;
  readResult(handle: string): VerbResult | Promise<VerbResult>;
  answerWorker(handle: string, question?: string): VerbResult | Promise<VerbResult>;
  askOwner(question: string, options: string[]): VerbResult | Promise<VerbResult>;
};

/** An action of the step script, and `ask-owner`, the verb a later flow may return. */
type Verb = Action | { do: 'ask-owner'; question: string; options?: string[] };

/** One verb for one action; `end` is no verb. */
async function execute(host: DriverHost, action: Verb): Promise<VerbResult> {
  switch (action.do) {
    case 'start-worker':
      return host.startWorker(action);
    case 'wait-any':
      return host.waitAny(action.handles, action.timeout);
    case 'read-result':
      // a blocked worker's question goes to answer-worker; a child process refuses it
      return action.question === undefined
        ? host.readResult(action.handle)
        : host.answerWorker(action.handle, action.question);
    case 'ask-owner':
      return host.askOwner(action.question, action.options ?? []);
    default:
      throw new Error(`unknown action ${JSON.stringify((action as { do?: unknown }).do)}`);
  }
}

/**
 * Drives one leaf: `step` is one call of the step script with the outcome of the verb before. Ends with the report
 * of `end`, or `stopped` when a stop request came in (the loop around the driver handles it).
 */
export async function driveLeaf({
  step,
  host,
  stopped,
}: {
  step: (result: StepResult | undefined) => Promise<Action>;
  host: DriverHost;
  stopped: () => boolean;
}): Promise<{ report: Report } | { stopped: true }> {
  let result: StepResult | undefined;
  for (;;) {
    if (stopped()) return { stopped: true };
    const action = await step(result);
    if (action.do === 'end') return { report: action.report };
    result = (await execute(host, action)) as StepResult;
  }
}
