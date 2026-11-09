import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv from 'ajv/dist/2020';
import { EVENT_SCHEMA } from '../../helpers/agent-events';
import { PwshWorker } from '../../helpers/pwsh-worker';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Report-Progress.ps1',
);
const SCHEMA = EVENT_SCHEMA;
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe.skipIf(!hasPwsh || process.platform === 'win32')('Report-Progress.ps1', () => {
  let root: string;
  let repo: string;
  let worker: PwshWorker;
  const validate = (() => {
    const ajv = new Ajv({ allErrors: true, validateFormats: false });
    return ajv.compile(JSON.parse(fs.readFileSync(SCHEMA, 'utf8')));
  })();
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', ...args], {
      cwd,
      encoding: 'utf8',
    }).trim();
  const baseEnv = (extra: Record<string, string> = {}) => {
    const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
    for (const k of ['AGENT_EVENTS_RUN', 'AGENT_EVENTS_DIR', 'POIMEN_TERMINAL_ID', 'HERDR_PANE_ID'])
      if (!(k in extra)) delete env[k];
    return env;
  };
  const events = (dir: string, run: string) =>
    fs
      .readFileSync(path.join(dir, `${run}.jsonl`), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l));
  const evDir = () => path.join(repo, '.git', '.agents', 'events');

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'progress-')));
    repo = path.join(root, 'repo');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'commit', '-q', '--allow-empty', '-m', 'init', '--no-gpg-sign');
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(() => {
    worker?.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('prints STOP requested after step.finished only when the stop file of the run contains now (#476)', async () => {
    const dir = path.join(root, 'ev-stop');
    const loopDir = path.join(root, 'loopdir');
    const env = baseEnv({
      AGENT_EVENTS_DIR: dir,
      AGENT_EVENTS_RUN: 'stop-run',
      DELIVER_LOOP_DIR: loopDir,
    });
    const args = ['-Type', 'step.finished', '-Issue', '1', '-Step', 'review', '-Result', 'clean'];
    const stop = path.join(loopDir, 'stop-run', 'stop');
    fs.mkdirSync(path.dirname(stop), { recursive: true });
    expect((await worker.run(args, { cwd: repo, env })).stdout).not.toContain('STOP requested');
    fs.writeFileSync(stop, '');
    expect((await worker.run(args, { cwd: repo, env })).stdout).not.toContain('STOP requested');
    fs.writeFileSync(stop, 'now\n');
    const r = await worker.run(args, { cwd: repo, env });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('STOP requested');
    expect(events(dir, 'stop-run')).toHaveLength(3);
    const other = await worker.run(['-Type', 'attention', '-Kind', 'paused'], { cwd: repo, env });
    expect(other.stdout).not.toContain('STOP requested');
  });

  it('creates a run on run.started, host from the environment, and every type validates in seq order', async () => {
    const dir = path.join(root, 'ev1');
    const start = await worker.run(
      [
        '-Type',
        'run.started',
        '-Source',
        'session',
        '-Harness',
        'claude',
        '-Model',
        'opus',
        '-Repository',
        'GravionLabs/skills',
        '-Milestone',
        'M5',
        '-MilestoneTitle',
        'M5 Events',
      ],
      {
        cwd: repo,
        env: baseEnv({ AGENT_EVENTS_DIR: dir, POIMEN_TERMINAL_ID: 't-1', HERDR_PANE_ID: 'p-2' }),
      },
    );
    expect(start.status).toBe(0);
    const run = /^AGENT_EVENTS_RUN=(\d{8}-\d{6}-[0-9a-f]{4})$/m.exec(start.stdout)![1];
    const env = baseEnv({
      AGENT_EVENTS_DIR: dir,
      AGENT_EVENTS_RUN: run,
      AGENT_EVENTS_OWNER: '1',
    });
    const calls: string[][] = [
      ['-Type', 'milestone.progress', '-Closed', '7', '-Total', '19'],
      ['-Type', 'issue.started', '-Issue', '322', '-Title', 'x', '-Url', 'https://x/322'],
      ['-Type', 'step.finished', '-Issue', '322', '-Step', 'review', '-Result', 'clean'],
      ['-Type', 'attention', '-Issue', '322', '-Kind', 'pr_opened', '-Pr', 'https://x/pull/5'],
      [
        '-Type',
        'issue.finished',
        '-Issue',
        '322',
        '-Outcome',
        'blocked',
        '-Reason',
        'open blocker',
      ],
      [
        '-Type',
        'release.updated',
        '-RcUrl',
        'https://x/rc',
        '-RcVersion',
        '1.2.0-rc.1',
        '-TestIssue',
        '400',
        '-TestIssueUrl',
        'https://x/400',
        '-PrUrl',
        'https://x/pull/9',
        '-ReviewRound',
        '2',
      ],
      ['-Type', 'run.finished', '-RunResult', 'done'],
    ];
    for (const c of calls) expect((await worker.run(c, { cwd: repo, env })).status).toBe(0);
    const evs = events(dir, run);
    expect(evs.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(evs.map((e) => e.type)).toEqual([
      'run.started',
      'milestone.progress',
      'issue.started',
      'step.finished',
      'attention',
      'issue.finished',
      'release.updated',
      'run.finished',
    ]);
    for (const e of evs) {
      expect(validate(e), JSON.stringify(validate.errors)).toBe(true);
      expect(e.run).toBe(run);
    }
    expect(evs[0]).toMatchObject({
      v: 1,
      source: 'session',
      harness: 'claude',
      model: 'opus',
      repository: 'GravionLabs/skills',
      milestone: { key: 'M5' },
      host: { poimenTerminal: 't-1', herdrPane: 'p-2' },
    });
    // #401: a session's run.started comes from a separate process that exits at once, so it records no pid
    expect(evs[0].pid).toBeUndefined();
    expect(evs[1]).toMatchObject({ closed: 7, total: 19 });
    expect(evs[3].step).toMatchObject({ name: 'review', n: 4, total: 7, text: 'clean' });
    // #372: issue.finished carries the reason (the projection's blocked and paused reason)
    expect(evs[5]).toMatchObject({ outcome: 'blocked', reason: 'open blocker', tone: 'danger' });
    expect(evs[6]).toMatchObject({
      rcUrl: 'https://x/rc',
      rcVersion: '1.2.0-rc.1',
      testIssue: { number: 400, url: 'https://x/400' },
      prUrl: 'https://x/pull/9',
      reviewRound: 2,
    });
  });

  it('an explicit -Run equal to the inherited run is nested too, unless the owner marker is set (#463)', async () => {
    const dir = path.join(root, 'ev-explicit');
    const nested = baseEnv({
      AGENT_EVENTS_DIR: dir,
      AGENT_EVENTS_RUN: 'loop-run2',
      AGENT_EVENTS_OWNER: '',
    });
    const own = baseEnv({
      AGENT_EVENTS_DIR: dir,
      AGENT_EVENTS_RUN: 'loop-run2',
      AGENT_EVENTS_OWNER: '1',
    });
    await worker.run(['-Type', 'run.started', '-Source', 'loop', '-Run', 'loop-run2'], {
      cwd: repo,
      env: own,
    });
    for (const t of [
      ['-Type', 'run.started', '-Source', 'session', '-Run', 'loop-run2'],
      ['-Type', 'run.finished', '-RunResult', 'done', '-Run', 'loop-run2'],
    ])
      expect((await worker.run(t, { cwd: repo, env: nested })).status).toBe(0);
    expect(events(dir, 'loop-run2').map((e) => e.type)).toEqual(['run.started']);
    await worker.run(['-Type', 'run.finished', '-RunResult', 'done', '-Run', 'loop-run2'], {
      cwd: repo,
      env: own,
    });
    expect(events(dir, 'loop-run2').map((e) => e.type)).toEqual(['run.started', 'run.finished']);
  });

  it('a nested session with an inherited AGENT_EVENTS_RUN neither starts nor finishes the run (#411)', async () => {
    const dir = path.join(root, 'ev-nested');
    // empty marker: the worker keeps variables a previous call set
    const env = baseEnv({
      AGENT_EVENTS_DIR: dir,
      AGENT_EVENTS_RUN: 'loop-run',
      AGENT_EVENTS_OWNER: '',
    });
    const own = baseEnv({
      AGENT_EVENTS_DIR: dir,
      AGENT_EVENTS_RUN: 'loop-run',
      AGENT_EVENTS_OWNER: '1',
    });
    expect(
      (await worker.run(['-Type', 'run.started', '-Source', 'loop'], { cwd: repo, env: own }))
        .status,
    ).toBe(0);
    for (const c of [
      ['-Type', 'run.started', '-Source', 'session'],
      ['-Type', 'step.finished', '-Step', 'review', '-Result', 'clean'],
      ['-Type', 'run.finished', '-RunResult', 'done'],
    ])
      expect((await worker.run(c, { cwd: repo, env })).status).toBe(0);
    // the nested run.started and run.finished are no-ops; other nested events still land
    expect(events(dir, 'loop-run').map((e) => e.type)).toEqual(['run.started', 'step.finished']);
    // the owner finishes its run
    await worker.run(['-Type', 'run.finished', '-RunResult', 'done'], { cwd: repo, env: own });
    expect(events(dir, 'loop-run').map((e) => e.type)).toEqual([
      'run.started',
      'step.finished',
      'run.finished',
    ]);
  });

  it('does not fold a live interactive session run to abandoned, a loop run keeps its pid (#401)', async () => {
    const reducer = path.resolve(
      __dirname,
      '../../../skills/delivery/deliver/scripts/ConvertFrom-ProgressEvents.ps1',
    );
    const dir = path.join(root, 'ev401');
    const env = baseEnv({ AGENT_EVENTS_DIR: dir });
    const start = (src: string) => {
      const r = spawnSync(
        'pwsh',
        ['-NoProfile', '-File', SCRIPT, '-Type', 'run.started', '-Source', src],
        { cwd: repo, env, encoding: 'utf8' },
      );
      return /AGENT_EVENTS_RUN=(\S+)/.exec(r.stdout)![1];
    };
    const session = start('session');
    const loop = start('loop');
    const result = (run: string) => {
      const r = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-Command',
          `Get-Content -LiteralPath '${path.join(dir, `${run}.jsonl`)}' | & '${reducer}'`,
        ],
        { cwd: repo, env, encoding: 'utf8' },
      );
      return JSON.parse(r.stdout).result;
    };
    expect(events(dir, session)[0].pid).toBeUndefined();
    expect(typeof events(dir, loop)[0].pid).toBe('number');
    // the writing process has exited; the session run is still running, the loop run (dead pid) is abandoned
    expect(result(session)).toBe('running');
    expect(result(loop)).toBe('abandoned');
  });

  it('writes the tone and needsYou of the ADR table', async () => {
    const dir = path.join(root, 'ev2');
    const env = baseEnv({
      AGENT_EVENTS_DIR: dir,
      AGENT_EVENTS_RUN: 'tones',
      AGENT_EVENTS_OWNER: '1',
    });
    const cases: [string[], string, boolean?][] = [
      [['-Type', 'attention', '-Kind', 'pr_opened'], 'success'],
      [['-Type', 'attention', '-Kind', 'review_fix'], 'warning'],
      [['-Type', 'attention', '-Kind', 'ci_red'], 'danger'],
      [['-Type', 'attention', '-Kind', 'paused'], 'warning'],
      [['-Type', 'attention', '-Kind', 'blocked'], 'danger'],
      [['-Type', 'attention', '-Kind', 'needs_you'], 'warning', true],
      [['-Type', 'attention', '-Kind', 'release_test'], 'warning', true],
      [['-Type', 'step.finished', '-Step', 'pr', '-Result', 'opened'], 'success'],
      [['-Type', 'step.finished', '-Step', 'review', '-Result', 'fix round 1'], 'warning'],
      [['-Type', 'step.finished', '-Step', 'review', '-Result', 'clean'], 'neutral'],
      [['-Type', 'step.finished', '-Step', 'ci', '-Result', 'red'], 'danger'],
      [['-Type', 'step.finished', '-Step', 'ci', '-Result', 'green'], 'neutral'],
      [['-Type', 'step.finished', '-Step', 'merge', '-Result', 'squash'], 'success'],
      [['-Type', 'step.finished', '-Step', 'done'], 'success'],
      [['-Type', 'step.finished', '-Step', 'implement', '-Result', 'paused: question'], 'warning'],
      [['-Type', 'step.finished', '-Step', 'implement', '-Result', 'blocked by #4'], 'danger'],
      [['-Type', 'issue.finished', '-Outcome', 'delivered'], 'success'],
      [['-Type', 'issue.finished', '-Outcome', 'blocked'], 'danger'],
      [['-Type', 'issue.finished', '-Outcome', 'paused'], 'warning'],
      [['-Type', 'issue.finished', '-Outcome', 'skipped'], 'neutral'],
      [['-Type', 'run.finished', '-RunResult', 'done'], 'success'],
      [['-Type', 'run.finished', '-RunResult', 'no progress'], 'warning'],
      [['-Type', 'run.finished', '-RunResult', 'blocked'], 'danger'],
      [['-Type', 'run.finished', '-RunResult', 'max reached'], 'neutral'],
      [['-Type', 'milestone.progress', '-Closed', '1', '-Total', '2'], 'neutral'],
    ];
    for (const [args] of cases) expect((await worker.run(args, { cwd: repo, env })).status).toBe(0);
    const evs = events(dir, 'tones');
    expect(evs.map((e) => e.tone)).toEqual(cases.map((c) => c[1]));
    expect(evs.map((e) => e.needsYou === true)).toEqual(cases.map((c) => c[2] === true));
    expect(evs.map((e) => e.seq)).toEqual(cases.map((_, i) => i + 1));
  });

  it('is a no-op without a run for every type but run.started', async () => {
    const dir = path.join(root, 'ev3');
    const r = await worker.run(['-Type', 'step.finished', '-Step', 'pr'], {
      cwd: repo,
      env: baseEnv({ AGENT_EVENTS_DIR: dir }),
    });
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('uses <git-common-dir>/.agents/events, also from a worktree', async () => {
    const wt = path.join(root, 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'wt-branch', wt);
    const env = baseEnv({ AGENT_EVENTS_RUN: 'fromgit' });
    await worker.run(['-Type', 'issue.started', '-Issue', '1'], { cwd: repo, env });
    await worker.run(['-Type', 'issue.started', '-Issue', '2'], { cwd: wt, env });
    expect(events(evDir(), 'fromgit').map((e) => [e.seq, e.issue.number])).toEqual([
      [1, 1],
      [2, 2],
    ]);
    expect(fs.existsSync(path.join(wt, '.git', 'events'))).toBe(false);
  });

  it('never fails the caller: an I/O error prints one stderr line and exits 0', () => {
    // own process: the real exit code and stderr
    const blocker = path.join(root, 'blocker');
    fs.writeFileSync(blocker, 'x');
    const r = spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, '-Type', 'run.started'], {
      cwd: repo,
      encoding: 'utf8',
      env: baseEnv({ AGENT_EVENTS_DIR: path.join(blocker, 'sub') }),
    });
    expect(r.status).toBe(0);
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
    expect(r.stderr).toContain('Report-Progress:');
  });
});
