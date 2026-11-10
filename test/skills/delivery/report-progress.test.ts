import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { checkRunFile } from '../../helpers/agent-events';
import { PwshWorker } from '../../helpers/pwsh-worker';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Report-Progress.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe.skipIf(!hasPwsh || process.platform === 'win32')('Report-Progress.ps1', () => {
  let root: string;
  let repo: string;
  let worker: PwshWorker;
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
    expect(events(dir, 'stop-run').map((e) => e.type)).toEqual([
      'task.started',
      'step.finished',
      'step.finished',
      'step.finished',
    ]);
    const other = await worker.run(['-Type', 'attention', '-Kind', 'paused'], { cwd: repo, env });
    expect(other.stdout).not.toContain('STOP requested');
  });

  it('creates a run on run.started and writes the core events plus the deliver profile, valid in seq order (#452)', async () => {
    const dir = path.join(root, 'ev1');
    const base = 'https://github.com/GravionLabs/skills';
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
        '-MilestoneUrl',
        `${base}/milestone/5`,
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
    const pr = `${base}/pull/5`;
    const calls: string[][] = [
      ['-Type', 'milestone.progress', '-Closed', '7', '-Total', '19'],
      ['-Type', 'issue.started', '-Issue', '322', '-Title', 'x', '-Url', `${base}/issues/322`],
      ['-Type', 'step.finished', '-Issue', '322', '-Step', 'review', '-Result', 'clean'],
      ['-Type', 'attention', '-Issue', '322', '-Kind', 'pr_opened', '-Pr', pr],
      ['-Type', 'attention', '-Issue', '323', '-Kind', 'needs_you', '-Reason', 'decide the key'],
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
        'issue.finished',
        '-Issue',
        '323',
        '-Outcome',
        'skipped',
        '-Reason',
        'no longer waiting',
      ],
      ['-Type', 'issue.finished', '-Issue', '324', '-Outcome', 'merging', '-Pr', `${base}/pull/6`],
      [
        '-Type',
        'release.updated',
        '-RcUrl',
        `${base}/rc`,
        '-RcVersion',
        '1.2.0-rc.1',
        '-TestIssue',
        '400',
        '-TestIssueUrl',
        `${base}/issues/400`,
        '-PrUrl',
        `${base}/pull/9`,
        '-ReviewRound',
        '2',
      ],
      ['-Type', 'iteration', '-Iteration', '1', '-IterationMax', '3'],
      ['-Type', 'step.finished', '-Issue', '322', '-Step', 'resume', '-Result', 'again'],
      ['-Type', 'run.finished', '-RunResult', 'max reached'],
    ];
    for (const c of calls) expect((await worker.run(c, { cwd: repo, env })).status).toBe(0);
    const text = fs.readFileSync(path.join(dir, `${run}.jsonl`), 'utf8');
    expect(checkRunFile(text, { known: true, deliver: true })).toEqual([]);
    const evs = events(dir, run);
    expect(evs.map((e) => [e.type, e.task ?? e.id ?? null])).toEqual([
      ['run.started', null],
      ['progress', null],
      ['task.started', 'issue-322'],
      ['step.finished', 'issue-322'],
      ['attention', 'issue-322'],
      ['attention', 'a6'], // needs_you: no task, it outlives the PBI
      ['task.finished', 'issue-322'],
      ['task.started', 'issue-323'], // a PBI that was never started: started, then finished
      ['task.finished', 'issue-323'],
      ['attention.resolved', 'a6'], // skipped resolves the needs-you attention of the issue
      ['task.started', 'issue-324'],
      ['deliver.merging', 'issue-324'],
      ['deliver.release.updated', null],
      ['deliver.iteration', null],
      ['task.started', 'issue-322.2'], // a later attempt of a finished issue
      ['step.finished', 'issue-322.2'],
      ['run.finished', null],
    ]);
    expect(evs[0]).toEqual({
      v: 1,
      seq: 1,
      ts: expect.any(String),
      run,
      type: 'run.started',
      tone: 'neutral',
      profiles: ['deliver@1'],
      profileSchemas: {
        'deliver@1': expect.stringMatching(/^https:\/\/.+deliver-profile\.schema\.json$/),
      },
      agent: { harness: 'claude', model: 'opus' },
      // #401: a session's run.started comes from a separate process that exits at once, so it records no pid
      host: { 'poimen.terminal': 't-1', 'herdr.pane': 'p-2' },
      subject: {
        kind: 'github.milestone',
        id: 'M5 Events',
        title: 'M5 Events',
        url: `${base}/milestone/5`,
      },
      deliver: { source: 'session', repository: 'GravionLabs/skills', milestone: { key: 'M5' } },
    });
    expect(evs[1]).toMatchObject({ done: 7, total: 19, label: 'PBIs' });
    expect(evs[1].task).toBeUndefined();
    expect(evs[2].subject).toEqual({
      kind: 'github.issue',
      id: 'GravionLabs/skills#322',
      title: 'x',
      url: `${base}/issues/322`,
    });
    expect(evs[3].step).toEqual({ name: 'review', n: 4, total: 7, text: 'clean' });
    expect(evs[4]).toMatchObject({
      reason: 'deliver.pr-opened',
      needsYou: false,
      links: [{ rel: 'pull-request', url: pr }],
      deliver: { kind: 'pr_opened', issue: 322 },
    });
    expect(evs[4].prUrl).toBeUndefined();
    expect(evs[5]).toMatchObject({
      needsYou: true,
      tone: 'warning',
      text: 'decide the key',
      deliver: { issue: 323 },
    });
    // #372: the reason of blocked and paused, now a code plus the human text (#516)
    expect(evs[6]).toMatchObject({
      outcome: 'skipped',
      reason: 'deliver.blocked',
      text: 'open blocker',
      tone: 'danger',
      deliver: { outcome: 'blocked' },
    });
    expect(evs[7].subject).toMatchObject({ title: '#323', url: `${base}/issues/323` });
    expect(evs[11]).toMatchObject({
      links: [{ rel: 'pull-request', url: `${base}/pull/6` }],
      deliver: { issue: 324 },
    });
    expect(evs[12].deliver).toEqual({
      round: 2,
      pr: `${base}/pull/9`,
      rcUrl: `${base}/rc`,
      rcVersion: '1.2.0-rc.1',
      testIssue: { number: 400, url: `${base}/issues/400` },
    });
    expect(evs[13].deliver).toEqual({ n: 1, max: 3 });
    expect(evs[16]).toMatchObject({
      outcome: 'succeeded',
      reason: 'deliver.max-reached',
      text: 'max reached',
      deliver: { result: 'max reached' },
    });
  });

  it('a subject for /deliver <nr>, the writer pid of a loop, -Code and usage errors', async () => {
    const dir = path.join(root, 'ev-subject');
    const env = baseEnv({ AGENT_EVENTS_DIR: dir });
    const start = await worker.run(
      [
        '-Type',
        'run.started',
        '-Source',
        'loop',
        '-Issue',
        '7',
        '-Title',
        'Seven',
        '-Repository',
        'a/b',
      ],
      { cwd: repo, env },
    );
    const run = /AGENT_EVENTS_RUN=(\S+)/.exec(start.stdout)![1];
    const own = baseEnv({ AGENT_EVENTS_DIR: dir, AGENT_EVENTS_RUN: run, AGENT_EVENTS_OWNER: '1' });
    const bad = [
      ['-Type', 'step.finished', '-Issue', '7'],
      ['-Type', 'attention', '-Issue', '7'],
      ['-Type', 'issue.finished', '-Outcome', 'delivered'],
      ['-Type', 'issue.finished', '-Issue', '7', '-Outcome', 'done'],
      ['-Type', 'nope'],
    ];
    for (const b of bad) {
      const r = await worker.run(b, { cwd: repo, env: own });
      expect(r.status).toBe(0);
    }
    await worker.run(
      [
        '-Type',
        'issue.finished',
        '-Issue',
        '7',
        '-Outcome',
        'paused',
        '-Code',
        'Needs Decision',
        '-Reason',
        'which key?',
      ],
      { cwd: repo, env: own },
    );
    const evs = events(dir, run);
    expect(evs[0].subject).toEqual({
      kind: 'github.issue',
      id: 'a/b#7',
      title: 'Seven',
      url: 'https://github.com/a/b/issues/7',
    });
    expect(evs[0].host['jsonl-file.pid']).toMatch(/^\d+$/);
    // the usage errors wrote nothing
    expect(evs.map((e) => e.type)).toEqual(['run.started', 'task.started', 'task.finished']);
    expect(evs[2]).toMatchObject({
      reason: 'deliver.needs-decision',
      text: 'which key?',
      tone: 'warning',
    });
    expect(
      checkRunFile(fs.readFileSync(path.join(dir, `${run}.jsonl`), 'utf8'), {
        known: true,
        deliver: true,
      }),
    ).toEqual([]);
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
      return JSON.parse(r.stdout).status;
    };
    expect(events(dir, session)[0].host['jsonl-file.pid']).toBeUndefined();
    expect(events(dir, loop)[0].host['jsonl-file.pid']).toMatch(/^\d+$/);
    // the writing process has exited; the session run is still running, the loop run (dead pid) is abandoned
    expect(result(session)).toBe('running');
    expect(result(loop)).toBe('abandoned');
  });

  it('writes the tone and needsYou of the profile tone rules', async () => {
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
      [['-Type', 'attention', '-Kind', 'stopping'], 'neutral'],
      [['-Type', 'issue.finished', '-Issue', '1', '-Outcome', 'delivered'], 'success'],
      [['-Type', 'issue.finished', '-Issue', '1', '-Outcome', 'blocked'], 'danger'],
      [['-Type', 'issue.finished', '-Issue', '1', '-Outcome', 'paused'], 'warning'],
      [['-Type', 'issue.finished', '-Issue', '1', '-Outcome', 'skipped'], 'neutral'],
      [['-Type', 'issue.finished', '-Issue', '1', '-Outcome', 'merging'], 'neutral'],
      [['-Type', 'run.finished', '-RunResult', 'done'], 'success'],
      [['-Type', 'run.finished', '-RunResult', 'no progress'], 'warning'],
      [['-Type', 'run.finished', '-RunResult', 'blocked'], 'danger'],
      [['-Type', 'run.finished', '-RunResult', 'max reached'], 'neutral'],
      [['-Type', 'milestone.progress', '-Closed', '1', '-Total', '2'], 'neutral'],
    ];
    for (const [args] of cases) expect((await worker.run(args, { cwd: repo, env })).status).toBe(0);
    const all = events(dir, 'tones');
    expect(all.map((e) => e.seq)).toEqual(all.map((_, i) => i + 1));
    // the started tasks of the issue.finished calls are not part of the table
    const evs = all.filter((e) => e.type !== 'task.started');
    expect(evs.map((e) => e.tone)).toEqual(cases.map((c) => c[1]));
    expect(evs.map((e) => e.needsYou === true)).toEqual(cases.map((c) => c[2] === true));
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
    expect(events(evDir(), 'fromgit').map((e) => [e.seq, e.task])).toEqual([
      [1, 'issue-1'],
      [2, 'issue-2'],
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
