import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { type Comment, marker, setupObjective, twoRepos } from '../../helpers/objective-loop';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #544: `deliver-loop takeover|release <objective>` (Set-ObjectiveRunner.ps1) against the fake GitHub of
// test/helpers/objective-loop.ts; this host is `here`, the other one `there`.
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Set-ObjectiveRunner.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const ago = (min: number) =>
  new Date(Date.now() - min * 60_000).toISOString().replace(/\.\d+Z$/, 'Z');

describe.skipIf(!hasPwsh || process.platform === 'win32')('Set-ObjectiveRunner.ps1', () => {
  let dir = '';
  let worker: PwshWorker;
  let seq = 0;
  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'objective-runner-')));
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const setup = (comments: Comment[]) => {
    const c = setupObjective(worker, path.join(dir, `case-${++seq}`), {
      ...twoRepos(),
      comments: { 'o/telos#1': comments },
    });
    const run = (args: string[]) =>
      worker.run(args, { cwd: path.join(c.root, 'telos'), env: c.env });
    const writes = () =>
      c.gh
        .calls()
        .filter((x) => x.args.includes('-X'))
        .map((x) => x.args.slice(1, 4).join(' '));
    return { ...c, run, writes };
  };

  it.each([
    ['a live foreign marker without -Force: refused', ago(5), [], 1, []],
    [
      'a live foreign marker with -Force',
      ago(5),
      ['-Force'],
      0,
      ['-X PATCH repos/o/telos/issues/comments/7'],
    ],
    [
      'a dead foreign marker (heartbeat 31 min ago) without asking',
      ago(31),
      [],
      0,
      ['-X PATCH repos/o/telos/issues/comments/7'],
    ],
  ])('takeover: %s', async (_name, beat, extra, status, expected) => {
    const c = setup([{ id: 7, body: marker('there', beat) }]);
    const r = await c.run(['takeover', 'o/telos#1', ...extra]);
    expect(r.status).toBe(status);
    expect(c.writes()).toEqual(expected);
    expect(c.comments()).toHaveLength(1);
    const host = status === 0 ? 'here' : 'there';
    expect(c.comments()[0].body).toContain(`objective-runner: host=${host} `);
    if (status === 1) expect(r.stdout).toContain('runs on there');
    else expect(r.stdout).toContain('runner: here took over o/telos#1 from there');
  });

  it('takeover without a marker creates the one comment', async () => {
    const c = setup([]);
    const r = await c.run(['takeover', 'o/telos#1']);
    expect(r.status).toBe(0);
    expect(c.writes()).toEqual(['-X POST repos/o/telos/issues/1/comments']);
    expect(c.comments()[0].body).toMatch(
      /^<!-- objective-runner: host=here since=\S+Z heartbeat=\S+Z -->/,
    );
  });

  it('release without a running loop: posts the status comment and deletes the own marker', async () => {
    const c = setup([{ id: 7, body: marker('here', ago(1)) }]);
    const r = await c.run(['release', 'o/telos#1']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('runner: status comment posted');
    expect(r.stdout).toContain('runner: runner marker released');
    expect(c.writes()).toEqual([
      '-X POST repos/o/telos/issues/1/comments',
      '-X DELETE repos/o/telos/issues/comments/7',
    ]);
    expect(c.comments()[0].body).toContain('o/a: 0/2 ready');
  });

  it('release of a foreign marker: refused, nothing written', async () => {
    const c = setup([{ id: 7, body: marker('there', ago(1)) }]);
    const r = await c.run(['release', 'o/telos#1']);
    expect(r.status).toBe(1);
    expect(c.writes()).toEqual([]);
  });

  it('release with a live loop on this host: writes the release request and the stop file of the running repository loop', async () => {
    const c = setup([{ id: 7, body: marker('here', ago(1)) }]);
    const checkout = path.join(c.root, 'a');
    const runDir = path.join(checkout, '.agents/deliver-loop/run-1');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(checkout, '.agents/deliver-loop/latest.txt'), runDir);
    const state = path.join(c.home, '.cache/deliver/objectives/o/telos/1');
    fs.mkdirSync(state, { recursive: true });
    // the test process stands in for the live objective loop
    fs.writeFileSync(
      path.join(state, 'running.json'),
      JSON.stringify({ pid: process.pid, host: 'here', checkout }),
    );
    const r = await c.run(['release', 'o/telos#1']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(
      `release requested: the runner of o/telos#1 (pid ${process.pid}) releases after the running PBI`,
    );
    expect(fs.existsSync(path.join(runDir, 'stop'))).toBe(true);
    expect(fs.existsSync(path.join(state, 'release'))).toBe(true);
    expect(c.writes()).toEqual([]);
  });

  it.each([[['takeover']], [['stop', 'o/telos#1']], [['release', 'telos-1']]])(
    'bad arguments %j exit 64',
    async (args) => {
      const r = await worker.run(args, { cwd: dir });
      expect(r.status).toBe(64);
    },
  );
});
