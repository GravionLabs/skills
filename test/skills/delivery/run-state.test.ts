import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv from 'ajv/dist/2020';
import { PwshWorker } from '../../helpers/pwsh-worker';

const ROOT = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(ROOT, 'skills/delivery/deliver/scripts/Get-RunState.ps1');
const STATE_SCHEMA = path.join(
  ROOT,
  'skills/delivery/deliver/schema/deliver-run-state.schema.json',
);
const FIXTURES = path.join(__dirname, 'fixtures/progress-events');
// the reducer's "now" and no pid test, as in progress-reducer.test.ts (written with a space: see there)
const NOW = '2026-11-07 12:00:00Z';
const FIXED = ['-Now', NOW, '-NoPidCheck'];
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const hasGit = spawnSync('git', ['--version']).status === 0;

const readJson = (p: string) => JSON.parse(fs.readFileSync(p, 'utf8'));
// a run is named by its fixture case: the file <case>.jsonl is the run <case>
const cases = fs
  .readdirSync(FIXTURES)
  .filter((f) => f.endsWith('.state.json'))
  .map((f) => f.replace(/\.state\.json$/, ''))
  .sort();
const ajv = new Ajv({ allErrors: true, validateFormats: false });
const validateState = ajv.compile(readJson(STATE_SCHEMA));

describe.skipIf(!hasPwsh || process.platform === 'win32')('Get-RunState.ps1 (#415)', () => {
  let worker: PwshWorker;
  let tmp: string;
  let events: string;

  // a run per fixture case, in an events directory of its own
  const run = (args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}) =>
    worker.run(args, {
      cwd: opts.cwd ?? tmp,
      env: opts.env ?? { ...process.env, AGENT_EVENTS_DIR: events },
    });
  const withoutEventsEnv = (): NodeJS.ProcessEnv => {
    const env = { ...process.env };
    delete env.AGENT_EVENTS_DIR;
    return env;
  };
  const snapshot = (dir: string) =>
    Object.fromEntries(
      fs.readdirSync(dir).map((f) => [f, fs.readFileSync(path.join(dir, f), 'utf8')]),
    );

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'run-state-'));
    events = path.join(tmp, 'events');
    fs.mkdirSync(events);
    for (const c of cases)
      fs.copyFileSync(path.join(FIXTURES, `${c}.jsonl`), path.join(events, `${c}.jsonl`));
    worker = new PwshWorker(SCRIPT);
  });

  afterAll(() => {
    worker?.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('-List: one entry per run, newest first, with the fold result and the last complete event', async () => {
    const r = await run(['-List', ...FIXED]);
    expect(r.status).toBe(0);
    const list = JSON.parse(r.stdout);
    expect(list.map((e: { run: string }) => e.run).sort()).toEqual(cases);
    const starts = list.map((e: { startedAt: string }) => Date.parse(e.startedAt));
    expect(starts).toEqual([...starts].sort((a: number, b: number) => b - a));

    const byRun = Object.fromEntries(list.map((e: { run: string }) => [e.run, e]));
    for (const c of cases) {
      expect(byRun[c].result, c).toBe(readJson(path.join(FIXTURES, `${c}.state.json`)).result);
    }
    // literal: the running fixture ends with a heartbeat at 11:50
    expect(byRun.running).toEqual({
      run: 'running',
      startedAt: '2026-11-07T10:00:00.000Z',
      result: 'running',
      lastType: 'heartbeat',
      lastTs: '2026-11-07T11:50:00.000Z',
    });
    expect(byRun.abandoned.result).toBe('abandoned');
  });

  it('-List: the incomplete last line is not the last event', async () => {
    const list = JSON.parse((await run(['-List', ...FIXED])).stdout);
    const entry = list.find((e: { run: string }) => e.run === 'incomplete-last-line');
    expect(entry).toMatchObject({ lastType: 'step.finished', lastTs: '2026-11-07T11:30:00.000Z' });
  });

  it('-List: an events directory that does not exist is an empty list, exit 0', async () => {
    const r = await run(['-List', ...FIXED], {
      env: { ...process.env, AGENT_EVENTS_DIR: path.join(tmp, 'missing') },
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('[]');
  });

  it('-List outside a repository without AGENT_EVENTS_DIR is an empty list, exit 0', async () => {
    const r = await run(['-List', ...FIXED], { env: withoutEventsEnv() });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('[]');
  });

  it.skipIf(!hasGit)(
    'resolves the events directory of the git common dir, AGENT_EVENTS_DIR wins over it',
    async () => {
      const repo = path.join(tmp, 'repo');
      fs.mkdirSync(repo);
      expect(spawnSync('git', ['-C', repo, 'init', '-q']).status).toBe(0);
      const repoEvents = path.join(repo, '.git', '.agents', 'events');
      fs.mkdirSync(repoEvents, { recursive: true });
      fs.copyFileSync(path.join(FIXTURES, 'running.jsonl'), path.join(repoEvents, 'running.jsonl'));

      const own = JSON.parse(
        (await run(['-List', ...FIXED], { cwd: repo, env: withoutEventsEnv() })).stdout,
      );
      expect(own.map((e: { run: string }) => e.run)).toEqual(['running']);
      const wins = JSON.parse((await run(['-List', ...FIXED], { cwd: repo })).stdout);
      expect(wins).toHaveLength(cases.length);
    },
  );

  it('-Run <id>: the fold, valid against deliver-run-state.schema.json', async () => {
    const r = await run(['-Run', 'running', ...FIXED]);
    expect(r.status).toBe(0);
    const state = JSON.parse(r.stdout);
    expect(validateState(state), JSON.stringify(validateState.errors)).toBe(true);
    expect(state).toEqual(readJson(path.join(FIXTURES, 'running.state.json')));
  });

  it('-Run <id> -After <seq>: the events after seq as the file lines, one JSON event each', async () => {
    const r = await run(['-Run', 'running', '-After', '4', ...FIXED]);
    expect(r.status).toBe(0);
    const lines = r.stdout.trimEnd().split('\n');
    expect(lines.map((l) => JSON.parse(l).seq)).toEqual([5, 6]);
    expect(lines).toEqual(
      fs.readFileSync(path.join(FIXTURES, 'running.jsonl'), 'utf8').trimEnd().split('\n').slice(4),
    );
  });

  it('-Run <id> -After at the last seq prints nothing, exit 0', async () => {
    const r = await run(['-Run', 'running', '-After', '6', ...FIXED]);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('unknown run: exit 1 with one line on stderr', () => {
    // a single spawn: the worker does not capture what the script writes to the process's own stderr
    const r = spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, '-Run', 'nope', ...FIXED], {
      cwd: tmp,
      env: { ...process.env, AGENT_EVENTS_DIR: events },
      encoding: 'utf8',
    });
    expect(r.status).toBe(1);
    expect(r.stdout.trim()).toBe('');
    expect(r.stderr.trim().split('\n')).toEqual(["unknown run 'nope'"]);
  });

  it('a run id with a path is unknown', async () => {
    const r = await run(['-Run', '../running', ...FIXED]);
    expect(r.status).toBe(1);
    expect(r.stdout.trim()).toBe('');
  });

  it('no events directory and an unknown run: exit 1', async () => {
    const r = await run(['-Run', 'running', ...FIXED], { env: withoutEventsEnv() });
    expect(r.status).toBe(1);
  });

  it('usage: no mode, two modes or -After without -Run exit 2', async () => {
    expect((await run([...FIXED])).status).toBe(2);
    expect((await run(['-List', '-NeedsAttention', ...FIXED])).status).toBe(2);
    expect((await run(['-List', '-After', '3', ...FIXED])).status).toBe(2);
  });

  it('-NeedsAttention: the open needs-you items of the running runs only', async () => {
    const att = path.join(tmp, 'attention');
    fs.mkdirSync(att);
    const url = 'https://github.com/GravionLabs/skills/issues/372';
    const started =
      '{"v":1,"seq":1,"ts":"2026-11-07T10:00:00.000Z","run":"%RUN%","type":"run.started","tone":"neutral","source":"loop"}';
    const needs =
      '{"v":1,"seq":2,"ts":"2026-11-07T11:00:00.000Z","run":"%RUN%","type":"attention","tone":"warning","needsYou":true,"kind":"needs_you","reason":"decide the key","issue":{"number":372,"url":"' +
      url +
      '"}}';
    const finished =
      '{"v":1,"seq":3,"ts":"2026-11-07T11:10:00.000Z","run":"%RUN%","type":"run.finished","tone":"success","result":"done"}';
    fs.writeFileSync(
      path.join(att, 'live.jsonl'),
      [started, needs].map((l) => l.replace(/%RUN%/g, 'live')).join('\n') + '\n',
    );
    fs.writeFileSync(
      path.join(att, 'ended.jsonl'),
      [started, needs, finished].map((l) => l.replace(/%RUN%/g, 'ended')).join('\n') + '\n',
    );

    const r = await run(['-NeedsAttention', ...FIXED], {
      env: { ...process.env, AGENT_EVENTS_DIR: att },
    });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([
      { run: 'live', number: 372, url, reason: 'decide the key' },
    ]);
  });

  it('never writes or deletes an event file', async () => {
    const before = snapshot(events);
    await run(['-List', ...FIXED]);
    await run(['-Run', 'running', ...FIXED]);
    await run(['-Run', 'running', '-After', '0', ...FIXED]);
    await run(['-NeedsAttention', ...FIXED]);
    await run(['-Run', 'nope', ...FIXED]);
    expect(snapshot(events)).toEqual(before);
  });
});
