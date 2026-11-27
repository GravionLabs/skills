// Validates the events of a run against a profile schema of this repository and the core rules of
// GravionLabs/agent-events (SPEC.md: Events, Reason and text, Profiles).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020';
import { expect } from 'vitest';

const CORE_TYPES = [
  'run.started',
  'run.finished',
  'task.started',
  'task.finished',
  'step.started',
  'step.finished',
  'progress',
  'attention',
  'attention.resolved',
];
const ENVELOPE = ['v', 'seq', 'ts', 'run', 'type', 'tone', 'needsYou'];
const REASON = /^[a-z][a-z0-9.-]*$/;

export type ProfileEvent = Record<string, unknown> & { type: string };

/** Returns a check of a whole run of the profile `<name>@<major>`, whose schema is `schema` (repository path). */
export function profileValidator(profile: string, schema: string) {
  const name = profile.split('@')[0]!;
  const file = path.resolve(__dirname, '../..', schema);
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
    JSON.parse(readFileSync(file, 'utf8')),
  );
  /** The errors of one event, empty for a valid one. */
  const errors = (event: ProfileEvent): string[] => {
    const found: string[] = [];
    if (!validate(event))
      found.push(...(validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`));
    const own = !CORE_TYPES.includes(event.type);
    if (own && !new RegExp(`^${name}(\\.[a-z][a-z0-9-]*)+$`).test(event.type))
      found.push(`type ${event.type} is neither core nor ${name}.<name>`);
    if (event.reason !== undefined && !REASON.test(String(event.reason)))
      found.push(`reason ${String(event.reason)} is no code`);
    // a profile adds no top-level field; reason and text are the core ones
    if (own) {
      const extra = Object.keys(event).filter(
        (key) => ![...ENVELOPE, 'reason', 'text', name].includes(key),
      );
      if (extra.length) found.push(`top-level fields ${extra.join(', ')}`);
    }
    return found;
  };
  return {
    errors,
    expectRun(events: ProfileEvent[]): void {
      expect(events[0]).toMatchObject({ type: 'run.started', profiles: [profile] });
      for (const event of events)
        expect({ event, errors: errors(event) }).toEqual({ event, errors: [] });
    },
  };
}
