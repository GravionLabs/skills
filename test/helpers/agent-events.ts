import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv/dist/2020';

// The core of the progress events (schemas and fixtures) comes from GravionLabs/agent-events at the tag in
// test/skills/delivery/agent-events/VERSION (ADR 0003). The directory is a copy of that tag's schema/ and fixtures/,
// verified by test/skills/delivery/agent-events.test.ts. The deliver profile (deliver@1) lives in skills:
// skills/delivery/deliver/schema/deliver-profile.schema.json and deliver-state.schema.json, its fixtures
// (<case>.jsonl, <case>.state.json, <case>.tokens.json) in test/skills/delivery/fixtures/progress-events/.
export const AGENT_EVENTS_DIR = path.resolve(__dirname, '../skills/delivery/agent-events');
export const AGENT_EVENTS_TAG = fs
  .readFileSync(path.join(AGENT_EVENTS_DIR, 'VERSION'), 'utf8')
  .trim();
export const CORE_SCHEMA = path.join(AGENT_EVENTS_DIR, 'schema/v0/core.schema.json');
export const CORE_STATE_SCHEMA = path.join(AGENT_EVENTS_DIR, 'schema/v0/run-state.schema.json');
export const CORE_EVENT_FIXTURES = path.join(AGENT_EVENTS_DIR, 'fixtures/events');
export const CORE_STATE_FIXTURES = path.join(AGENT_EVENTS_DIR, 'fixtures/state');
// the reader's clock of the core state fixtures without a <case>.now file
export const CORE_DEFAULT_NOW = '2026-11-08T10:30:00.000Z';

const DELIVER_SCHEMA_DIR = path.resolve(__dirname, '../../skills/delivery/deliver/schema');
export const DELIVER_PROFILE_SCHEMA = path.join(DELIVER_SCHEMA_DIR, 'deliver-profile.schema.json');
export const DELIVER_STATE_SCHEMA = path.join(DELIVER_SCHEMA_DIR, 'deliver-state.schema.json');
export const DELIVER_FIXTURES = path.resolve(
  __dirname,
  '../skills/delivery/fixtures/progress-events',
);

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
// formats are not checked by Ajv here (no ajv-formats); ts is checked below like the core validator's date-time
const ajv = new Ajv({ allErrors: true, strict: false, validateFormats: false });
const coreEvent = ajv.compile(readJson(CORE_SCHEMA));
const deliverEvent = ajv.compile(readJson(DELIVER_PROFILE_SCHEMA));
export const validateCoreState = ajv.compile(readJson(CORE_STATE_SCHEMA));
export const validateDeliverState = ajv.compile(readJson(DELIVER_STATE_SCHEMA));

export const CORE_TYPES = [
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
const TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;
const MAX_LINE_BYTES = 16384;

// The errors of one run file, in line order (empty: valid). The rules of the core validator of the pinned tag
// (schema per line, first event run.started and only once, gapless seq from 1, one run id, done <= total, line length,
// an incomplete last line skipped). `deliver: true` adds the deliver profile schema on every line (our runs declare
// deliver@1); `known: true` (what our writers emit) also rejects a type that is neither a core type nor a deliver.*
// type: a pre-core type such as issue.started fails.
export function checkRunFile(
  text: string,
  opts: { known?: boolean; deliver?: boolean } = {},
): string[] {
  const errors: string[] = [];
  if (text === '') return ['file has no events'];
  const lines = text.split('\n');
  const incompleteLast = !text.endsWith('\n');
  if (!incompleteLast) lines.pop();
  let expectedSeq = 1;
  let run: string | undefined;
  lines.forEach((line, i) => {
    const n = i + 1;
    const err = (m: string) => errors.push(`line ${n}: ${m}`);
    if (Buffer.byteLength(line) > MAX_LINE_BYTES) return err('line too long');
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(line);
    } catch {
      if (!(incompleteLast && i === lines.length - 1)) err('not JSON');
      return;
    }
    let valid = true;
    for (const v of opts.deliver ? [coreEvent, deliverEvent] : [coreEvent]) {
      if (v(e)) continue;
      valid = false;
      err(`schema ${JSON.stringify(v.errors)}`);
    }
    if (!valid) return;
    if (typeof e.ts !== 'string' || !TS.test(e.ts) || Number.isNaN(Date.parse(e.ts))) err('bad ts');
    const type = String(e.type);
    if (opts.known && !CORE_TYPES.includes(type) && !type.startsWith('deliver.'))
      err(`unknown type ${type}`);
    if (type === 'progress' && Number(e.done) > Number(e.total)) err('done above total');
    if (i === 0 && type !== 'run.started') err(`first event is ${type}`);
    if (i > 0 && type === 'run.started') err('run.started is not the first event');
    if (e.seq !== expectedSeq) err(`seq ${e.seq}, expected ${expectedSeq}`);
    expectedSeq = Number(e.seq) + 1;
    run ??= String(e.run);
    if (e.run !== run) err(`run changed from ${run} to ${e.run}`);
  });
  return errors;
}

// The run files of an events directory, each checked with known types and the deliver profile; {file: errors}, only files with errors.
export function checkEventsDir(dir: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.jsonl'))) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const errs = checkRunFile(text, { known: true, deliver: true });
    if (errs.length) out[f] = errs;
  }
  return out;
}
