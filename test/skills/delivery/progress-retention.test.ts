import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { REPORT_PROGRESS } from '../../helpers/report-progress';

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const DAY = 86400_000;

describe.skipIf(!hasPwsh || process.platform === 'win32')('progress retention', () => {
  let root: string;
  let events: string;
  let loop: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'retention-'));
    events = path.join(root, '.agents/events');
    loop = path.join(root, '.agents/deliver-loop');
    fs.mkdirSync(events, { recursive: true });
    fs.mkdirSync(loop, { recursive: true });
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  const age = (p: string, days: number) => {
    const t = new Date(Date.now() - days * DAY);
    fs.utimesSync(p, t, t);
  };
  const run = (name: string, lines: object[], days: number) => {
    const f = path.join(events, `${name}.jsonl`);
    fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    age(f, days);
  };
  const finished = [{ type: 'run.started', pid: 1 }, { type: 'run.finished' }];
  const recording = (name: string, days: number) => {
    const d = path.join(loop, name);
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, '1.jsonl'), '{}\n');
    age(d, days);
  };
  const start = (env: Record<string, string> = {}) => {
    const e: NodeJS.ProcessEnv = { ...process.env, AGENT_EVENTS_DIR: events, ...env };
    if (!('AGENT_EVENTS_RUN' in env)) delete e.AGENT_EVENTS_RUN;
    return spawnSync('pwsh', ['-NoProfile', '-File', REPORT_PROGRESS, '-Type', 'run.started'], {
      cwd: root,
      env: e,
      encoding: 'utf8',
    });
  };
  const has = (n: string) => fs.existsSync(path.join(events, `${n}.jsonl`));

  it('deletes finished and abandoned runs older than the keep days, keeps young ones', () => {
    run('old-finished', finished, 10);
    run('old-abandoned', [{ type: 'run.started', pid: 99999999 }], 10);
    run('young-finished', finished, 1);
    recording('old-rec', 10);
    recording('young-rec', 1);
    start();
    expect(has('old-finished')).toBe(false);
    expect(has('old-abandoned')).toBe(false);
    expect(has('young-finished')).toBe(true);
    expect(fs.existsSync(path.join(loop, 'old-rec'))).toBe(false);
    expect(fs.existsSync(path.join(loop, 'young-rec'))).toBe(true);
  });

  it('keeps at most AGENT_EVENTS_KEEP runs, the newest', () => {
    for (let i = 1; i <= 5; i++) run(`r${i}`, finished, i / 10);
    for (let i = 1; i <= 5; i++) recording(`d${i}`, i / 10);
    start({ AGENT_EVENTS_KEEP: '3', AGENT_EVENTS_KEEP_DAYS: '30' });
    // the new run is the newest of the events, so two of the old ones stay
    expect(['r1', 'r2', 'r3', 'r4', 'r5'].filter(has)).toEqual(['r1', 'r2']);
    expect(fs.readdirSync(loop).sort()).toEqual(['d1', 'd2', 'd3']);
  });

  it('never deletes a run with a live pid, deletes one unchanged for an hour', () => {
    run('live', [{ type: 'run.started', pid: process.pid }], 0.01);
    run('stale-live', [{ type: 'run.started', pid: process.pid }], 10);
    start({ AGENT_EVENTS_KEEP_DAYS: '0' });
    expect(has('live')).toBe(true);
    expect(has('stale-live')).toBe(false);
  });

  it('keeps the current run and its recording', () => {
    const cur = path.join(events, 'cur.jsonl');
    fs.writeFileSync(cur, '');
    age(cur, 30);
    recording('cur', 30);
    start({ AGENT_EVENTS_RUN: 'cur' });
    expect(has('cur')).toBe(true);
    expect(fs.existsSync(path.join(loop, 'cur'))).toBe(true);
  });
});
