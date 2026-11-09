import * as fs from 'fs';
import * as path from 'path';
import Ajv from 'ajv/dist/2020';
import { AGENT_EVENTS_FIXTURES } from '../../helpers/agent-events';

const ROOT = path.resolve(__dirname, '../../..');
const SCHEMA = path.join(ROOT, 'skills/delivery/deliver/schema/progress-tokens.schema.json');
const BACKENDS = path.join(ROOT, 'skills/delivery/deliver/references/terminal-backends.md');
const FIXTURES = path.join(__dirname, 'fixtures/progress-events'); // *.tokens.json
const EVENTS = AGENT_EVENTS_FIXTURES; // *.jsonl and *.state.json of the pinned agent-events tag

const TOKENS = ['deliver', 'deliver_step', 'deliver_pr', 'deliver_progress', 'deliver_tone'];
type Tokens = Record<string, string | null>;
type Entry = {
  seq?: number;
  abandoned?: true;
  tokens: Tokens;
  agent: string | null;
  pane: string | null;
};

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
const cases = fs
  .readdirSync(EVENTS)
  .filter((f) => f.endsWith('.jsonl'))
  .map((f) => f.replace(/\.jsonl$/, ''))
  .sort();
const lines = (c: string) =>
  fs
    .readFileSync(path.join(EVENTS, `${c}.jsonl`), 'utf8')
    .split('\n')
    .filter((l) => l !== '');
const expected = (c: string): Entry[] => readJson(path.join(FIXTURES, `${c}.tokens.json`));
const validate = new Ajv({ allErrors: true }).compile(readJson(SCHEMA));

describe('fixtures/progress-events/<case>.tokens.json (#414)', () => {
  it('every event fixture has a token fixture, at least the cases of the PBI', () => {
    for (const c of [
      'running',
      'done',
      'blocked',
      'paused-needs-you',
      'abandoned',
      'incomplete-last-line',
    ])
      expect(cases).toContain(c);
    for (const c of cases)
      expect(fs.existsSync(path.join(FIXTURES, `${c}.tokens.json`)), c).toBe(true);
  });

  it.each(cases)(
    '%s: valid against progress-tokens.schema.json, one entry per complete line',
    (c) => {
      const entries = expected(c);
      expect(validate(entries), JSON.stringify(validate.errors)).toBe(true);
      const seqs = lines(c).flatMap((l) => {
        try {
          return [JSON.parse(l).seq as number];
        } catch {
          return [];
        }
      });
      expect(entries.filter((e) => e.seq !== undefined).map((e) => e.seq)).toEqual(seqs);
      const pane = JSON.parse(lines(c)[0]).host?.herdrPane ?? null;
      for (const e of entries) expect(e.pane).toBe(pane);
    },
  );

  it.each(cases)(
    '%s: an abandoned entry is the last one, exactly when the run state is abandoned',
    (c) => {
      const entries = expected(c);
      const result = readJson(path.join(EVENTS, `${c}.state.json`)).result;
      expect(entries.findIndex((e) => e.abandoned)).toBe(
        result === 'abandoned' ? entries.length - 1 : -1,
      );
    },
  );

  it('abandoned: the final entry clears all five tokens and releases the agent', () => {
    const entries = expected('abandoned');
    expect(entries[entries.length - 1]).toEqual({
      abandoned: true,
      tokens: {
        deliver: null,
        deliver_step: null,
        deliver_pr: null,
        deliver_progress: null,
        deliver_tone: null,
      },
      agent: 'released',
      pane: 'w1:p2',
    });
  });

  it('deliver_step is cut at 80 characters', () => {
    const step = expected('blocked').find((e) => e.seq === 4)?.tokens.deliver_step;
    expect(step).toBe(
      '7/7 ci: red: lint failed in skills/delivery/deliver/scripts/Report-Progress.ps1:',
    );
    expect(step).toHaveLength(80);
  });

  it('unknown event types and fields change no token (running: futureField, tool.used, heartbeat)', () => {
    const bySeq = new Map(expected('running').map((e) => [e.seq, e]));
    expect(bySeq.get(4)).toEqual({ ...bySeq.get(3), seq: 4 });
    expect(bySeq.get(6)).toEqual({ ...bySeq.get(5), seq: 6 });
  });

  it('references/terminal-backends.md points to the fixtures and the schema as the source of the mapping', () => {
    const md = fs.readFileSync(BACKENDS, 'utf8');
    expect(md).toContain('test/skills/delivery/fixtures/progress-events/<case>.tokens.json');
    expect(md).toContain('schema/progress-tokens.schema.json');
  });
});
