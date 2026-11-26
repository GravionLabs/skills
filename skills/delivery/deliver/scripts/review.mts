// The review of a delivered issue is its own session (`/deliver-review`, ADR 0009): its settings and the
// verdict it writes to DELIVER_REVIEW_FILE. The file is written by an agent: it is validated, never trusted.
import { HARNESSES, type Harness } from './harness.mts';

export type Verdict = {
  verdict: 'approve' | 'changes';
  findings: { severity: 'blocking'; file: string; summary: string }[];
  unmet: string[];
};

const text = (value: unknown): value is string => typeof value === 'string' && value.trim() !== '';
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

/**
 * The verdict of the file content, `undefined` when it breaks the contract. An `approve` with a finding or an
 * unmet criterion, and a `changes` with neither, contradict themselves and are invalid too.
 */
export function parseVerdict(content: string): Verdict | undefined {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return undefined;
  }
  if (!object(value)) return undefined;
  const { verdict, findings, unmet } = value;
  if (verdict !== 'approve' && verdict !== 'changes') return undefined;
  if (!Array.isArray(findings) || !Array.isArray(unmet)) return undefined;
  const valid = findings.every(
    (f) => object(f) && f.severity === 'blocking' && text(f.file) && text(f.summary),
  );
  if (!valid || !unmet.every(text)) return undefined;
  if ((findings.length + unmet.length === 0) !== (verdict === 'approve')) return undefined;
  return { verdict, findings, unmet } as Verdict;
}

/** The findings and unmet criteria as one line of the report, without control characters. */
export function findingsLine(verdict: Verdict): string {
  const parts = [
    ...verdict.findings.map((f) => `${f.file}: ${f.summary}`),
    ...verdict.unmet.map((criterion) => `unmet: ${criterion}`),
  ];
  const line = parts.join('; ').replace(/[\u0000-\u001f\u007f-\u009f]+/g, ' ');
  return line.length > 500 ? `${line.slice(0, 500)}…` : line;
}

export const REVIEW_KEYS = ['model', 'harness', 'effort'];

export type ReviewSettings = {
  harnessName: string;
  harness: Harness;
  model: string;
  effort?: string;
};

/**
 * The settings of the review session: the flag, then `deliver.review`, else the harness of the implementer with
 * a model that is not the implementer's. Throws an Error whose message names the wrong setting.
 */
export function reviewSettings(input: {
  flags: { model?: string; harness?: string };
  config: unknown;
  implementer: { harnessName: string; model: string };
}): ReviewSettings {
  const config = object(input.config) ? input.config : {};
  const harnessName = String(
    input.flags.harness ?? config.harness ?? input.implementer.harnessName,
  );
  if (!Object.hasOwn(HARNESSES, harnessName))
    throw new Error(
      `unknown review harness "${harnessName}": one of ${Object.keys(HARNESSES).join(', ')}`,
    );
  const harness = HARNESSES[harnessName];
  const [first, second] = harness.reviewModels;
  // the same family counts as the same model: `claude-opus-…` and `opus`
  const family = (model: string) => /fable|opus|sonnet|haiku/i.exec(model)?.[0].toLowerCase();
  const other = family(input.implementer.model) === family(first) ? second : first;
  const model = input.flags.model ?? config.model ?? other;
  // a model name goes into the command line: never one that reads as an option
  if (typeof model !== 'string' || !/^[A-Za-z0-9][\w.:/[\]-]*$/.test(model))
    throw new Error('the review model (--review-model, deliver.review.model) is no model name');
  const { effort } = config;
  if (effort !== undefined && !harness.efforts.includes(effort as string))
    throw new Error(
      `deliver.review.effort of ${harnessName} is one of ${harness.efforts.join(', ')}`,
    );
  return { harnessName, harness, model, effort: effort as string | undefined };
}
