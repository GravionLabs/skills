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
