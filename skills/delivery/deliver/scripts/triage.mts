// The result of a `deliver-triage` session (ADR 0011): one allowed action. The file is written by an agent: it is
// validated, never trusted, and what breaks the contract goes to the owner.

export type Triage =
  | { action: 'answer'; answer: string; evidence: string[] }
  | { action: 'drop'; reason: string }
  | { action: 'draft-issue'; title: string; body: string }
  | { action: 'rerun-ci'; job: number; reason: string }
  | { action: 'needs-owner'; reason: string; options: string[] };

type Check = (value: unknown) => boolean;

const text: Check = (value) => typeof value === 'string' && value.trim() !== '';
const texts: Check = (value) => Array.isArray(value) && value.length > 0 && value.every(text);
const title: Check = (value) => text(value) && /^\[(PBI|Bug)\] [^\r\n]+$/.test(value as string);
const id: Check = (value) => Number.isSafeInteger(value) && (value as number) > 0;

// the fields of each action: all required, no others
const ACTIONS: Record<Triage['action'], Record<string, Check>> = {
  answer: { answer: text, evidence: texts },
  drop: { reason: text },
  'draft-issue': { title, body: text },
  'rerun-ci': { job: id, reason: text },
  'needs-owner': { reason: text, options: texts },
};

const rejected = (why: string): Triage => ({
  action: 'needs-owner',
  reason: `invalid triage result: ${why}`,
  options: ['Decide the case yourself'],
});

/**
 * The action of the result file content. A missing file (`undefined`) and everything that breaks the contract of
 * `deliver-triage` (`references/actions.md`) become `needs-owner`; the reason never quotes the content.
 */
export function parseTriage(content: string | undefined): Triage {
  if (content === undefined) return rejected('no result file');
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch {
    return rejected('not JSON');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return rejected('not an object');
  const { action, ...fields } = value as Record<string, unknown>;
  if (typeof action !== 'string' || !Object.hasOwn(ACTIONS, action))
    return rejected('unknown action');
  const checks = ACTIONS[action as Triage['action']];
  if (Object.keys(fields).some((name) => !Object.hasOwn(checks, name)))
    return rejected(`unknown field for ${action}`);
  const bad = Object.keys(checks).find((name) => !checks[name]?.(fields[name]));
  if (bad) return rejected(`${action} needs a valid ${bad}`);
  return value as Triage;
}

/**
 * An attention case of an Objective run that one `deliver-triage` session judges (#1127): an issue handed over or set
 * aside with `needs-decision`, a run blocked by a red base, a milestone done. `key` names it: a case is triaged once per
 * run.
 */
export type TriageCase = {
  kind: 'handover' | 'needs-decision' | 'blocked' | 'milestone-done';
  repo: string;
  issue?: number;
  pr?: string;
  milestone?: string;
  /** The reason of the loop, as in the attention event. */
  reason: string;
  text: string;
};

/** What all units of an Objective run share: the cases triaged and the CI jobs re-run, by repository. */
export type TriageRun = { seen: Set<string>; reruns: Set<string> };

export const triageRun = (): TriageRun => ({ seen: new Set(), reruns: new Set() });

export const caseKey = (triage: TriageCase): string =>
  `${triage.repo.toLowerCase()}:${triage.kind}:${triage.issue ?? triage.milestone ?? 'run'}`;

/** The name of the files of the case in the run folder. */
export const caseSlug = (triage: TriageCase): string =>
  `triage-${triage.kind}-${triage.issue ?? triage.milestone ?? 'run'}`.replace(
    /[^A-Za-z0-9._-]+/g,
    '-',
  );

/** The prepared text a person reads for a `draft-issue` or a `needs-owner` result. */
export function preparedText(triage: TriageCase, result: Triage): string | undefined {
  const about = `${triage.repo}${triage.issue ? `#${triage.issue}` : ''} (${triage.kind}): ${triage.text}`;
  if (result.action === 'draft-issue')
    return `# ${result.title}\n\n<!-- drafted by deliver-triage for ${about} -->\n\n${result.body}\n`;
  if (result.action === 'needs-owner')
    return `# Decide: ${about}\n\n${result.reason}\n\n${result.options.map((option, i) => `${i + 1}. ${option}`).join('\n')}\n`;
  return undefined;
}

/** The comment of an `answer` result on the issue; the marker keeps it to one per issue. */
export const ANSWER_MARKER = '<!-- deliver-triage: answer -->';
export function answerComment(result: Extract<Triage, { action: 'answer' }>): string {
  return `${ANSWER_MARKER}\n**Answer of the triage** (needs-decision removed)\n\n${result.answer}\n\nEvidence:\n${result.evidence.map((line) => `- ${line}`).join('\n')}\n`;
}
