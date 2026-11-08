import * as fs from 'fs';
import * as path from 'path';

// The progress event contract (schemas and fixtures) comes from GravionLabs/agent-events at the tag in
// test/skills/delivery/agent-events/VERSION (ADR 0003). The directory is a copy of that tag, verified by
// test/skills/delivery/agent-events.test.ts. Token fixtures (*.tokens.json) stay in fixtures/progress-events.
export const AGENT_EVENTS_DIR = path.resolve(__dirname, '../skills/delivery/agent-events');
export const AGENT_EVENTS_TAG = fs
  .readFileSync(path.join(AGENT_EVENTS_DIR, 'VERSION'), 'utf8')
  .trim();
export const EVENT_SCHEMA = path.join(AGENT_EVENTS_DIR, 'schema/progress-event.schema.json');
export const STATE_SCHEMA = path.join(AGENT_EVENTS_DIR, 'schema/deliver-run-state.schema.json');
export const AGENT_EVENTS_FIXTURES = path.join(AGENT_EVENTS_DIR, 'fixtures');
