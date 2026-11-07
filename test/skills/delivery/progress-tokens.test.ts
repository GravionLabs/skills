import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv from 'ajv/dist/2020';
import { PwshWorker } from '../../helpers/pwsh-worker';

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'skills/delivery/deliver/scripts/Report-Progress.ps1');
const SCHEMA = path.join(ROOT, 'skills/delivery/deliver/schema/progress-tokens.schema.json');
const BACKENDS = path.join(ROOT, 'skills/delivery/deliver/references/terminal-backends.md');
const FIXTURES = path.join(__dirname, 'fixtures/progress-events');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

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
  .readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.jsonl'))
  .map((f) => f.replace(/\.jsonl$/, ''))
  .sort();
const lines = (c: string) =>
  fs
    .readFileSync(path.join(FIXTURES, `${c}.jsonl`), 'utf8')
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
      const result = readJson(path.join(FIXTURES, `${c}.state.json`)).result;
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
    expect(md).not.toMatch(/^\| `step\.finished` +\| `Set-LoopTokens`/m);
  });
});

// The current terminal sink (Report-Progress.ps1 -SinkEvent, as Invoke-DeliverLoop.ps1 calls it) must yield the token
// fixtures, so fixtures and sink cannot drift while the displays move to reading the events (ADR 0002).
describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'terminal sink against the token fixtures',
  () => {
    let root: string;
    let bin: string;
    let calls: string;
    let worker: PwshWorker;

    // one call per record: the arguments one per line (values hold spaces), then a separator line
    const recorded = (): string[][] => {
      if (!fs.existsSync(calls)) return [];
      return fs
        .readFileSync(calls, 'utf8')
        .split('\n@@end\n')
        .filter((r) => r !== '')
        .map((r) => r.split('\n'));
    };

    // the herdr calls of one event folded into the display state; every call targets `pane`
    const apply = (
      state: { tokens: Tokens; agent: string | null },
      call: string[],
      pane: string,
    ) => {
      const [, sub, target, ...rest] = call;
      expect(call[0]).toBe('pane');
      if (sub === 'get') return;
      expect(target).toBe(pane);
      if (sub === 'report-metadata') {
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === '--token') {
            const [k, ...v] = rest[++i].split('=');
            state.tokens[k] = v.join('=');
          } else if (rest[i] === '--clear-token') state.tokens[rest[++i]] = null;
        }
      } else if (sub === 'report-agent') state.agent = rest[rest.indexOf('--state') + 1];
      else if (sub === 'release-agent') state.agent = 'released';
      else throw new Error(`unexpected herdr call: ${call.join(' ')}`);
    };

    const sink = async (line: string, pr: string, pane: string) => {
      fs.rmSync(calls, { force: true });
      const r = await worker.run(['-Type', 'step.finished', '-SinkEvent', line, '-Pr', pr], {
        cwd: root,
        env: {
          PATH: `${bin}${path.delimiter}${process.env.PATH}`,
          HOME: root,
          DELIVER_TERMINAL_BACKEND: 'herdr',
          HERDR_PANE_ID: pane,
        },
      });
      expect(r.status).toBe(0);
      return recorded();
    };

    // feeds the event file line by line; an unparseable line goes through the sink too and must change nothing
    const replay = async (c: string): Promise<Entry[]> => {
      const state = {
        tokens: Object.fromEntries(TOKENS.map((t) => [t, null])) as Tokens,
        agent: null,
      };
      let pane = '';
      const out: Entry[] = [];
      for (const line of lines(c)) {
        let ev: { seq: number; type: string; prUrl?: string; host?: { herdrPane?: string } } | null;
        try {
          ev = JSON.parse(line);
        } catch {
          ev = null;
        }
        if (ev?.type === 'run.started') pane = ev.host?.herdrPane ?? '';
        const got = await sink(line, ev?.prUrl ?? '', pane);
        if (!ev) {
          expect(got).toEqual([]);
          continue;
        }
        for (const call of got) apply(state, call, pane);
        out.push({
          seq: ev.seq,
          tokens: { ...state.tokens },
          agent: state.agent,
          pane: pane || null,
        });
      }
      return out;
    };

    beforeAll(() => {
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'progress-tokens-')));
      bin = path.join(root, 'bin');
      calls = path.join(root, 'calls.txt');
      fs.mkdirSync(bin);
      fs.writeFileSync(
        path.join(bin, 'herdr'),
        `#!/bin/sh\nfor a in "$@"; do printf '%s\\n' "$a" >> "${calls}"; done\nprintf '@@end\\n' >> "${calls}"\n`,
        { mode: 0o755 },
      );
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(() => {
      worker?.close();
      fs.rmSync(root, { recursive: true, force: true });
    });

    it.each(cases)('%s: the sink yields the entries of <case>.tokens.json', async (c) => {
      const want = expected(c);
      const events = want.filter((e) => !e.abandoned);
      expect(await replay(c)).toEqual(events);
      const end = want.find((e) => e.abandoned);
      if (!end) return;
      // abandoned has no event: the sink's run.finished (what the loop's finally sends) must show the same final state
      const last = events[events.length - 1];
      const pane = last.pane ?? '';
      const state = { tokens: { ...last.tokens }, agent: last.agent };
      const finished = JSON.stringify({
        v: 1,
        seq: (last.seq ?? 0) + 1,
        type: 'run.finished',
        tone: 'neutral',
      });
      for (const call of await sink(finished, '', pane)) apply(state, call, pane);
      expect({ abandoned: true, ...state, pane: last.pane }).toEqual(end);
    });

    it('the same event file yields the same token sequence twice', async () => {
      expect(await replay('running')).toEqual(await replay('running'));
    });

    it('an unknown type and an unknown field call no backend', async () => {
      const line = lines('running')[2];
      expect(JSON.parse(line).futureField).toBeDefined();
      const { futureField: _, ...known } = JSON.parse(line);
      const withField = await sink(line, '', 'w1:p2');
      expect(await sink(JSON.stringify(known), '', 'w1:p2')).toEqual(withField);
      expect(await sink(lines('running')[3], '', 'w1:p2')).toEqual([]);
    });
  },
);
