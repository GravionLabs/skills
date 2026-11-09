import { spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv from 'ajv/dist/2020';
import { AGENT_EVENTS_FIXTURES, EVENT_SCHEMA, STATE_SCHEMA } from '../../helpers/agent-events';
import { PwshWorker } from '../../helpers/pwsh-worker';

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'skills/delivery/deliver/scripts/ConvertFrom-ProgressEvents.ps1');
const FIXTURES = AGENT_EVENTS_FIXTURES;
// every fixture pair is folded with this "now" and without the pid test (the fixture pid is not a live process).
// Written with a space, not a T: the worker reads its request with ConvertFrom-Json, which would turn an ISO string
// into a DateTime and hand the script a local-time string.
const NOW = '2026-11-07 12:00:00Z';
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
const cases = fs
  .readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.jsonl'))
  .map((f) => f.replace(/\.jsonl$/, ''))
  .sort();
const ajv = new Ajv({ allErrors: true, validateFormats: false });
const validateState = ajv.compile(readJson(STATE_SCHEMA));
const validateEvent = ajv.compile(readJson(EVENT_SCHEMA));

describe('fixtures/progress-events (#370)', () => {
  it('has at least the cases of the PBI', () => {
    for (const c of [
      'running',
      'done',
      'blocked',
      'paused-needs-you',
      'release-review-round',
      'rc-test-open',
      'abandoned',
      'incomplete-last-line',
    ])
      expect(cases).toContain(c);
  });

  it.each(cases)('%s: every complete line is a valid progress event, the state is valid', (c) => {
    const lines = fs.readFileSync(path.join(FIXTURES, `${c}.jsonl`), 'utf8').split('\n');
    const complete = lines.slice(0, -1);
    for (const l of complete) {
      expect(validateEvent(JSON.parse(l)), JSON.stringify(validateEvent.errors)).toBe(true);
    }
    const state = readJson(path.join(FIXTURES, `${c}.state.json`));
    expect(validateState(state), JSON.stringify(validateState.errors)).toBe(true);
  });
});

describe('deliver-run-state.schema.json (#370)', () => {
  const running = () => readJson(path.join(FIXTURES, 'running.state.json'));

  it('has no schemaVersion, five run results plus abandoned and the RC fields', () => {
    const next = readJson(STATE_SCHEMA);
    expect(next.required).not.toContain('schemaVersion');
    expect(next.properties.result.enum).toEqual([
      'running',
      'done',
      'max reached',
      'blocked',
      'no progress',
      'abandoned',
    ]);
    expect(Object.keys(next.properties.release.properties)).toEqual([
      'reviewRound',
      'prUrl',
      'rcUrl',
      'rcVersion',
      'testIssue',
    ]);
  });

  it('rejects a schemaVersion-free state with a result outside the six states', () => {
    expect(validateState({ ...running(), result: 'stopped' })).toBe(false);
    expect(validateState({ ...running(), result: 'abandoned' })).toBe(true);
  });

  it('rejects a test issue without a number', () => {
    const s = running();
    s.release.testIssue = { url: 'https://x/400' };
    expect(validateState(s)).toBe(false);
  });
});

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'ConvertFrom-ProgressEvents.ps1 (#370)',
  () => {
    let worker: PwshWorker;
    let tmp: string;
    const fold = async (file: string, ...extra: string[]) => {
      const r = await worker.run(['-Path', file, '-Now', NOW, '-NoPidCheck', ...extra], {
        cwd: tmp,
      });
      return { ...r, state: r.status === 0 ? JSON.parse(r.stdout) : null };
    };
    const writeEvents = (name: string, text: string) => {
      const f = path.join(tmp, `${name}.jsonl`);
      fs.writeFileSync(f, text);
      return f;
    };
    const fixtureLines = (c: string) =>
      fs
        .readFileSync(path.join(FIXTURES, `${c}.jsonl`), 'utf8')
        .trimEnd()
        .split('\n');

    beforeAll(() => {
      tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reducer-')));
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(() => {
      worker?.close();
      fs.rmSync(tmp, { recursive: true, force: true });
    });

    it.each(cases)('folds %s.jsonl into %s.state.json, valid against the schema', async (c) => {
      const r = await fold(path.join(FIXTURES, `${c}.jsonl`));
      expect(r.status, r.stderr).toBe(0);
      expect(r.state).toEqual(readJson(path.join(FIXTURES, `${c}.state.json`)));
      expect(validateState(r.state), JSON.stringify(validateState.errors)).toBe(true);
    });

    it('folds run.finished with result stopped as a finished run (#474)', async () => {
      const lines = fixtureLines('done').map((l) => {
        const e = JSON.parse(l);
        if (e.type === 'run.finished') e.result = 'stopped';
        return JSON.stringify(e);
      });
      const r = await fold(writeEvents('stopped', lines.join('\n') + '\n'));
      expect(r.status, r.stderr).toBe(0);
      expect(r.state).toEqual(readJson(path.join(FIXTURES, 'done.state.json')));
    });

    it('yields the same state for the same events and Now', async () => {
      const f = path.join(FIXTURES, 'rc-test-open.jsonl');
      expect((await fold(f)).stdout).toBe((await fold(f)).stdout);
    });

    it.each(['done', 'paused-needs-you', 'rc-test-open'])(
      '%s: unknown event types and fields never change the state',
      async (c) => {
        const lines = fixtureLines(c).map((l) => {
          const e = JSON.parse(l);
          e.futureField = { nested: [1, 2] };
          if (e.issue) e.issue.extra = 'x';
          return JSON.stringify(e);
        });
        const unknown = (seq: number) =>
          JSON.stringify({
            v: 1,
            seq,
            ts: '2026-11-07T11:59:00.000Z',
            run: 'x',
            type: 'future.thing',
            tone: 'info',
            issue: { number: 999 },
          });
        const noisy = [lines[0], unknown(2), ...lines.slice(1), unknown(99)].join('\n') + '\n';
        const r = await fold(writeEvents(`noisy-${c}`, noisy));
        expect(r.state).toEqual(readJson(path.join(FIXTURES, `${c}.state.json`)));
      },
    );

    it('depends only on the events up to the last complete line', async () => {
      const lines = fixtureLines('done');
      const head = lines.slice(0, -1).join('\n') + '\n';
      const cut = await fold(writeEvents('cut', head + lines.at(-1)!.slice(0, 40)));
      const whole = await fold(writeEvents('head', head));
      expect(cut.state).toEqual(whole.state);
      expect(cut.state.closed).toBe(4);
      expect(cut.stderr).toBe('');
    });

    it('reports a gap in seq on stderr and folds the events anyway', async () => {
      const lines = fixtureLines('done').filter((l) => JSON.parse(l).seq !== 3);
      const r = await fold(writeEvents('gap', lines.join('\n') + '\n'));
      expect(r.status).toBe(0);
      expect(r.stderr).toContain('seq gap: expected 3, got 4');
      expect(r.state.delivered).toEqual([
        {
          pbi: 370,
          url: 'https://github.com/GravionLabs/skills/issues/370',
          prUrl: 'https://github.com/GravionLabs/skills/pull/380',
        },
      ]);
    });

    it('a run without run.finished is running within the hour and abandoned after it', async () => {
      const f = path.join(FIXTURES, 'running.jsonl');
      const at = async (now: string) =>
        (await worker.run(['-Path', f, '-Now', now, '-NoPidCheck'], { cwd: tmp })).stdout;
      expect(JSON.parse(await at('2026-11-07 12:30:00Z')).result).toBe('running');
      const late = JSON.parse(await at('2026-11-07 12:30:01Z'));
      expect(late.result).toBe('abandoned');
      expect(late.current).toBeNull();
    });

    it('a run whose pid no longer lives is abandoned, a live pid keeps it running', async () => {
      const dead = spawn('true');
      await new Promise((res) => dead.on('exit', res));
      const withPid = (pid: number) =>
        fixtureLines('running')
          .map((l) => {
            const e = JSON.parse(l);
            if (e.type === 'run.started') e.pid = pid;
            return JSON.stringify(e);
          })
          .join('\n') + '\n';
      const run = async (name: string, pid: number) =>
        JSON.parse(
          (await worker.run(['-Path', writeEvents(name, withPid(pid)), '-Now', NOW], { cwd: tmp }))
            .stdout,
        ).result;
      expect(await run('dead', dead.pid!)).toBe('abandoned');
      expect(await run('alive', process.pid)).toBe('running');
    });

    it('numbers a step without n by its name, and a later outcome of an issue replaces the earlier one', async () => {
      const [start] = fixtureLines('running');
      const ev = (seq: number, type: string, extra: object) =>
        JSON.stringify({
          v: 1,
          seq,
          ts: '2026-11-07T11:50:00.000Z',
          run: 'r',
          type,
          tone: 'neutral',
          ...extra,
        });
      const issue = { number: 380 };
      const running = await fold(
        writeEvents(
          'names',
          [
            start,
            ev(2, 'issue.started', { issue }),
            ev(3, 'step.finished', { issue, step: { name: 'fix', text: 'round 1' } }),
          ].join('\n') + '\n',
        ),
      );
      expect(running.state.current).toEqual({
        number: 380,
        title: '#380',
        url: 'https://github.com/GravionLabs/skills/issues/380',
        step: { n: 5, total: 7, text: 'fix: round 1' },
        prUrl: null,
      });
      const later = await fold(
        writeEvents(
          'later',
          [
            start,
            ev(2, 'issue.finished', { issue, outcome: 'blocked' }),
            ev(3, 'issue.finished', { issue, outcome: 'delivered' }),
          ].join('\n') + '\n',
        ),
      );
      expect(later.state.blocked).toEqual([]);
      expect(later.state.delivered.map((d: { pbi: number }) => d.pbi)).toEqual([380]);
    });

    it('a new RC test issue replaces the older one in needsYou', async () => {
      const gh = 'https://github.com/GravionLabs/skills';
      const lines = [
        ...fixtureLines('rc-test-open').slice(0, 5),
        JSON.stringify({
          v: 1,
          seq: 6,
          ts: '2026-11-07T11:20:00.000Z',
          run: 'r',
          type: 'release.updated',
          tone: 'neutral',
          rcVersion: '3.3.0-rc.1',
          testIssue: { number: 410, url: `${gh}/issues/410` },
        }),
      ];
      const r = await fold(writeEvents('replace', lines.join('\n') + '\n'));
      expect(r.state.needsYou).toEqual([
        { number: 410, url: `${gh}/issues/410`, reason: 'RC test' },
      ]);
      expect(r.state.release).toMatchObject({
        rcVersion: '3.3.0-rc.1',
        testIssue: { number: 410 },
      });
    });

    it('fails with one stderr line when there is no event', async () => {
      const empty = await worker.run(['-Path', writeEvents('empty', ''), '-Now', NOW], {
        cwd: tmp,
      });
      expect(empty.status).toBe(1);
      expect(empty.stderr).toContain('no progress events');
      const missing = await worker.run(['-Path', path.join(tmp, 'nope.jsonl')], { cwd: tmp });
      expect(missing.status).toBe(1);
      expect(missing.stderr).toContain('no event file');
    });

    it('reads the events from the pipeline', () => {
      // own process: pipeline input from Get-Content
      const f = path.join(FIXTURES, 'blocked.jsonl');
      const r = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-Command',
          `Get-Content -LiteralPath '${f}' | & '${SCRIPT}' -Now '${NOW}' -NoPidCheck`,
        ],
        { encoding: 'utf8' },
      );
      expect(r.status, r.stderr).toBe(0);
      expect(JSON.parse(r.stdout)).toEqual(readJson(path.join(FIXTURES, 'blocked.state.json')));
    });
  },
);
