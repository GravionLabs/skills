// deliver: the loop (deliver-loop.mts) against a fake tracker and a fake harness in a real git repository, and
// the check verdict of the GitHub tracker. The loop is started as its own process, as a user starts it.
import { execFileSync, spawn } from 'node:child_process';
import { generateKeyPairSync, createVerify } from 'node:crypto';
import { type Server, createServer } from 'node:http';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  APP_PERMISSIONS,
  appSettings,
  tokenSource,
} from '../../../skills/delivery/deliver/scripts/app-token.mts';
import {
  cmdLine,
  launchCommand,
  promptPath,
  resolveWindows,
} from '../../../skills/delivery/deliver/scripts/process.mts';
import { HARNESSES } from '../../../skills/delivery/deliver/scripts/harness.mts';
import {
  checkVerdict,
  mergedPullSince,
  closesIssue,
  openPullsOf,
} from '../../../skills/delivery/deliver/scripts/tracker/github.mts';

const skill = path.resolve(__dirname, '../../../skills/delivery/deliver');
const loopScript = path.join(skill, 'scripts/deliver-loop.mts');
const helpers = path.resolve(__dirname, 'deliver');

type Result = { issue: number; outcome: string; reason?: string; risk?: string };

type Scenario = {
  items: { id: number; title: string; blockedBy?: number[] }[];
  gates?: unknown[];
  files?: string[];
  filesLater?: string[];
  required?: string[];
  needsDecision?: boolean;
  gateBlockMs?: number;
  stopInGate?: boolean;
  stopInChangedFiles?: boolean;
  exits?: number[];
  noPull?: boolean;
  risks?: Record<number, string>;
  filesFailures?: number;
  blocked?: string;
  earlierPull?: boolean;
  twoPulls?: number[];
  lingers?: boolean;
  hangs?: boolean;
  plan?: { exit?: number; noPull?: boolean; hangs?: boolean }[];
  closeAfterCalls?: number;
  releaseTests?: number[];
  releaseCommits?: number;
  base?: string[];
  mergedBefore?: number[];
  mergedDuring?: number[];
};
type Outcome = {
  status: number | null;
  stdout: string;
  stderr: string;
  merges: { pull: number; head: string }[];
  releasePulls: number;
  calls: string[];
  sessions: {
    id: number;
    prompt: string;
    run: string | null;
    ghToken: string | null;
    hasSessionTokenVariable: boolean;
  }[];
  results: Result[];
  final?: Record<string, unknown>;
  events: { type: string; outcome?: string; reason?: string; needsYou?: boolean }[];
  log: string;
};

let root: string;
let repo: string;
let count = 0;

const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.test', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
const lines = <T>(file: string): T[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];

/** Runs the loop for one scenario. `whenStdout` is called with the output so far (the stop case sends a signal). */
function loop(
  scenario: Scenario,
  options: {
    args?: string[];
    milestone?: boolean;
    env?: Record<string, string>;
    whenStdout?: (out: string, stop: () => void) => void;
  } = {},
): Promise<Outcome> {
  count += 1;
  const dir = path.join(root, `case-${count}`);
  mkdirSync(dir);
  writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(scenario));
  if (scenario.earlierPull)
    for (const item of scenario.items) writeFileSync(path.join(dir, `pr-${item.id}`), '');
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    FAKE_DIR: dir,
    AGENT_EVENTS_DIR: path.join(dir, 'events'),
    DELIVER_TRACKER_DIR: path.join(helpers, 'tracker'),
    DELIVER_HARNESS: JSON.stringify(['node', path.join(helpers, 'fake-harness.mjs'), dir]),
    DELIVER_TICK_MS: '1',
    GH_TOKEN: 'login-token',
    ...options.env,
  };
  if (!options.env?.['DELIVER_SESSION_TOKEN']) delete env['DELIVER_SESSION_TOKEN'];
  // the user's own (old or new) variables must not leak into the loop under test
  delete env['DELIVER_MIN_SESSION_TOKEN'];
  const issues = scenario.items.map((item) => item.id).join(',');
  return new Promise((done) => {
    const child = spawn(
      'node',
      [
        loopScript,
        '--tracker',
        'fake',
        ...(options.milestone ? ['--milestone', 'M001'] : ['--issues', issues]),
        ...(options.args ?? []),
      ],
      { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let stdout = '';
    let stderr = '';
    let signalled = false;
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      options.whenStdout?.(stdout, () => {
        if (!signalled) {
          // Windows cannot deliver SIGINT to a process: the loop also stops on a file `stop` in its run folder
          const results = /results: (\S+)/.exec(stdout)?.[1];
          if (process.platform === 'win32' && results)
            writeFileSync(path.join(path.dirname(results), 'stop'), '');
          else child.kill('SIGINT');
        }
        signalled = true;
      });
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => {
      const results = /results: (\S+)/.exec(stdout)?.[1];
      const events = path.join(dir, 'events');
      done({
        status,
        stdout,
        stderr,
        merges: lines<{ call: string; pull: number; head: string }>(
          path.join(dir, 'calls.jsonl'),
        ).filter((call) => call.call === 'merge'),
        releasePulls: lines<{ call: string }>(path.join(dir, 'calls.jsonl')).filter(
          (call) => call.call === 'releasePull',
        ).length,
        calls: lines<{ call: string }>(path.join(dir, 'calls.jsonl')).map((call) => call.call),
        sessions: lines(path.join(dir, 'sessions.jsonl')),
        results: results
          ? lines<Result | { issue?: undefined }>(results).filter(
              (r): r is Result => r.issue !== undefined,
            )
          : [],
        final: results ? lines<Record<string, unknown>>(results).find((r) => r.run) : undefined,
        events: existsSync(events) ? lines(path.join(events, readdirSync(events)[0] ?? '')) : [],
        log: results
          ? readFileSync(path.join(path.dirname(path.dirname(results)), 'loop.log'), 'utf8')
          : '',
      });
    });
  });
}

const READY = { state: 'ready', reported: true, head: 'abc123' };
const RED = { state: 'red', detail: 'ci' };

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'deliver-'));
  const origin = path.join(root, 'origin.git');
  repo = path.join(root, 'repo');
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch', 'main', origin]);
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main', repo]);
  writeFileSync(path.join(repo, 'README.md'), 'fixture\n');
  git(repo, 'add', 'README.md');
  git(repo, 'commit', '--quiet', '-m', 'chore: fixture');
  git(repo, 'remote', 'add', 'origin', origin);
  git(repo, 'push', '--quiet', 'origin', 'main', 'main:release/next');
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('deliver loop: base check', () => {
  const items = [{ id: 81, title: '[PBI] feat: one' }];

  it('starts the issue on a green base without a rerun', async () => {
    const out = await loop({ items, base: ['green'] });
    expect(out.status).toBe(0);
    expect(out.calls).not.toContain('rerun');
    expect(out.merges).toHaveLength(1);
  });

  it('reruns a red base once and goes on when it is green, no Bug', async () => {
    const out = await loop({ items, base: ['red', 'green'] });
    expect(out.status).toBe(0);
    expect(out.calls).toContain('rerun');
    expect(out.calls).not.toContain('baseBug');
    expect(out.log).toContain('main: green after rerun (flake)');
    expect(out.merges.map((m) => m.pull)).toEqual([181]);
  });

  it('files a Bug for a base that stays red, delivers it first and goes on', async () => {
    const out = await loop({ items, base: ['red', 'red', 'green'] });
    expect(out.status).toBe(0);
    expect(out.calls.filter((c) => c === 'baseBug')).toHaveLength(1);
    expect(out.merges.map((m) => m.pull)).toEqual([1000, 181]);
    expect(out.sessions.map((s) => s.id)).toEqual([900, 81]);
  });

  it('ends blocked (exit 2) when the base is red after its repair', async () => {
    const out = await loop({ items, base: ['red', 'red', 'red'] });
    expect(out.status).toBe(2);
    expect(out.merges.map((m) => m.pull)).toEqual([1000]);
    expect(out.sessions.map((s) => s.id)).toEqual([900]);
    const last = out.stdout.trim().split('\n').slice(-1)[0];
    expect(out.stdout).toMatch(
      /blocked: main is red \(ci\) after its repair, Bug https:\/\/example\.test\/issues\/900/,
    );
    expect(last).toBeTruthy();
    expect(out.events.at(-1)).toMatchObject({ outcome: 'failed' });
  });

  it('starts the issue when the base state cannot be read', async () => {
    const out = await loop({ items, base: ['throw'] });
    expect(out.status).toBe(0);
    expect(out.merges).toHaveLength(1);
    expect(out.log).toContain('state unreadable');
  });
});

describe('deliver loop', () => {
  it('merges an issue and then the issue it blocked', async () => {
    const out = await loop({
      items: [
        { id: 12, title: '[PBI] feat: second', blockedBy: [11] },
        { id: 11, title: '[PBI] feat: first' },
      ],
    });
    expect(out.status).toBe(0);
    expect(out.merges).toEqual([
      { call: 'merge', pull: 111, head: 'abc123' },
      { call: 'merge', pull: 112, head: 'abc123' },
    ]);
    expect(out.results.map((r) => [r.issue, r.outcome])).toEqual([
      [11, 'merged'],
      [12, 'merged'],
    ]);
    // --issues without a base: the default branch
    expect(out.sessions[0]?.prompt).toMatch(
      /^\/deliver 11 --base main --issue-file \S+11\.issue\.md$/,
    );
    expect(out.events.map((e) => e.type)).toEqual([
      'run.started',
      'progress',
      'task.started',
      'step.finished',
      'task.finished',
      'progress',
      'task.started',
      'step.finished',
      'task.finished',
      'progress',
      'run.finished',
    ]);
    expect(out.events.at(-1)?.outcome).toBe('succeeded');
    // the bar after each start line (NO_COLOR: plain text); the second issue is the last one
    expect(out.stdout).toMatch(/#11 start: .*\n.* \[█+░+\] 1 of 2\n/);
    expect(out.stdout).toMatch(/#12 start: .*\n.* \[█{20}\] 2 of 2\n/);
    expect(out.stdout).not.toContain('\x1b');
    // merged: the worktree of the issue is gone
    expect(existsSync(path.join(root, 'repo-wt-11'))).toBe(false);
  });

  it('waits until a merged issue is closed so the issue it blocked is delivered in the same run', async () => {
    const out = await loop({
      items: [
        { id: 72, title: '[PBI] feat: second', blockedBy: [71] },
        { id: 71, title: '[PBI] feat: first' },
      ],
      closeAfterCalls: 4,
    });
    expect(out.status).toBe(0);
    expect(out.results.map((r) => [r.issue, r.outcome])).toEqual([
      [71, 'merged'],
      [72, 'merged'],
    ]);
    expect(out.events.at(-1)?.outcome).toBe('succeeded');
  });

  it('does not merge the open pull request of a failed session', async () => {
    const out = await loop({ items: [{ id: 21, title: '[PBI] feat: fails' }], exits: [3] });
    expect(out.status).toBe(2);
    expect(out.merges).toEqual([]);
    expect(out.results[0]).toMatchObject({ outcome: 'aside', reason: 'session failed (exit 3)' });
    expect(out.events.find((e) => e.type === 'attention')).toMatchObject({
      reason: 'set-aside',
      needsYou: true,
    });
    // an incomplete run does not end as succeeded; the text names the counts
    expect(out.events.at(-1)).toMatchObject({
      type: 'run.finished',
      outcome: 'failed',
      reason: 'incomplete',
      text: 'blocked: merged 0, set aside 1, waiting 0',
    });
    // not merged: the worktree may hold work that is not pushed
    expect(existsSync(path.join(root, 'repo-wt-21'))).toBe(true);
  });

  it('starts one repair session for a red check and merges when it is green', async () => {
    const out = await loop({
      items: [{ id: 31, title: '[PBI] feat: red once' }],
      gates: [RED, READY],
    });
    expect(out.status).toBe(0);
    expect(out.sessions).toHaveLength(2);
    expect(out.merges).toHaveLength(1);
  });

  it('sets an issue aside when the check is red after the repair session', async () => {
    const out = await loop({ items: [{ id: 41, title: '[PBI] feat: red twice' }], gates: [RED] });
    expect(out.status).toBe(2);
    expect(out.sessions).toHaveLength(2);
    expect(out.merges).toEqual([]);
    expect(out.results[0]).toMatchObject({ outcome: 'aside', reason: 'red: ci' });
  });

  it('ends a loop interrupted with Ctrl+C during a hanging session as stopped', async () => {
    const out = await loop(
      { items: [{ id: 53, title: '[PBI] feat: hangs' }], hangs: true },
      { whenStdout: (stdout, stop) => stdout.includes('working') && stop() },
    );
    expect(out.status).toBe(130);
    expect(out.merges).toEqual([]);
    expect(out.results[0]).toMatchObject({ outcome: 'stopped' });
    expect(out.final).toMatchObject({ run: 'finished' });
    const finished = out.events.filter((e) => e.type === 'run.finished');
    expect(finished).toHaveLength(1);
    expect(finished[0]).toMatchObject({ outcome: 'cancelled' });
    expect(finished[0]?.reason).toBeUndefined();
    expect(JSON.stringify(finished[0])).not.toMatch(/no progress|failed/);
  }, 20_000);

  it('does not merge after a stop request during the check wait', async () => {
    const out = await loop(
      {
        items: [{ id: 51, title: '[PBI] feat: stopped' }],
        gates: [{ state: 'pending', reported: true }],
      },
      { whenStdout: (stdout, stop) => stdout.includes('waits for checks') && stop() },
    );
    expect(out.status).toBe(130);
    expect(out.merges).toEqual([]);
    expect(out.results[0]).toMatchObject({ outcome: 'stopped' });
    expect(out.events.at(-1)).toMatchObject({ type: 'run.finished', outcome: 'cancelled' });
  });

  // SIGINT cannot be sent to a process on Windows; there the stop file is only read every 500 ms
  it.skipIf(process.platform === 'win32').each([
    ['gate', { stopInGate: true }],
    ['the read of the changed files', { stopInChangedFiles: true }],
  ] as const)('does not merge when the stop request arrives during %s', async (_name, stop) => {
    // the fake tracker sends the stop request inside the call: no timing window in the test
    const out = await loop({
      items: [{ id: 52, title: '[PBI] feat: stopped late' }],
      ...stop,
    });
    expect(out.status).toBe(130);
    expect(out.merges).toEqual([]);
    expect(out.results[0]).toMatchObject({ outcome: 'stopped' });
  });

  it('does not merge a pull request that got a protected path after the session ended', async () => {
    const out = await loop({
      items: [{ id: 62, title: '[PBI] feat: pushed later' }],
      filesLater: ['src/a.ts', '.github/workflows/x.yml'],
    });
    expect(out.status).toBe(3);
    expect(out.sessions).toHaveLength(1);
    expect(out.merges).toEqual([]);
    expect(out.results[0]?.reason).toBe(
      'changes protected paths (.github/workflows/x.yml), merge it yourself',
    );
  });

  it.each([
    ['another case', '.Claude/settings.json'],
    ['a file named like a protected directory', '.agents'],
    ['a manifest in another case', 'sub/Package.json'],
  ])('treats %s as a protected path', async (_name, file) => {
    count += 1;
    const out = await loop({
      items: [{ id: 600 + count, title: '[PBI] feat: path' }],
      files: [file],
    });
    expect(out.status).toBe(3);
    expect(out.merges).toEqual([]);
  });

  it('does not merge an older pull request when the session asked for a decision', async () => {
    const out = await loop({
      items: [{ id: 63, title: '[PBI] feat: question' }],
      needsDecision: true,
    });
    expect(out.status).toBe(2);
    expect(out.merges).toEqual([]);
    expect(out.results[0]).toMatchObject({ outcome: 'aside', reason: 'needs-decision' });
  });

  it('starts no repair session when a person closed the pull request', async () => {
    const out = await loop({
      items: [{ id: 64, title: '[PBI] feat: closed' }],
      gates: [{ state: 'closed' }],
    });
    expect(out.status).toBe(2);
    expect(out.sessions).toHaveLength(1);
    expect(out.results[0]?.reason).toBe('pull request closed');
  });

  it('refuses a test hook that points into the repository', () => {
    const refusal = (env: Record<string, string>): string => {
      try {
        execFileSync('node', [loopScript, '--issues', '1'], {
          cwd: repo,
          env: { ...process.env, ...env },
          stdio: 'pipe',
        });
        return 'not refused';
      } catch (error) {
        const { status, stderr } = error as { status: number; stderr: Buffer };
        return `${status} ${String(stderr).trim()}`;
      }
    };
    expect(refusal({ DELIVER_TRACKER_DIR: path.join(repo, 'tools') })).toBe(
      '64 DELIVER_TRACKER_DIR must not be inside the repository',
    );
    expect(refusal({ DELIVER_HARNESS: JSON.stringify(['node', path.join(repo, 'x.mjs')]) })).toBe(
      '64 DELIVER_HARNESS must not name a file inside the repository',
    );
  });

  it('sets a pull request aside that changes a protected path', async () => {
    const out = await loop({
      items: [{ id: 61, title: '[PBI] ci: workflow' }],
      files: ['src/a.ts', '.github/workflows/ci.yml', 'packages/x/package.json'],
    });
    expect(out.status).toBe(3);
    expect(out.sessions).toHaveLength(1);
    expect(out.merges).toEqual([]);
    expect(out.results[0]?.reason).toBe(
      'changes protected paths (.github/workflows/ci.yml, packages/x/package.json), merge it yourself',
    );
  });

  it('reads the changed files again after a failed read', async () => {
    const out = await loop({
      items: [{ id: 71, title: '[PBI] feat: flaky read' }],
      filesFailures: 1,
    });
    expect(out.status).toBe(0);
    expect(out.merges).toHaveLength(1);
  });

  it('hands the issue over after the reads kept failing', async () => {
    const out = await loop({
      items: [{ id: 72, title: '[PBI] feat: broken read' }],
      filesFailures: 9,
    });
    expect(out.merges).toEqual([]);
    expect(out.results[0]?.reason).toContain('could not read the changed files (HTTP 500)');
  });

  it('starts no session for an open pull request that changes a protected path', async () => {
    const out = await loop({
      items: [{ id: 73, title: '[PBI] feat: earlier pull' }],
      files: ['Cargo.toml'],
      earlierPull: true,
    });
    expect(out.sessions).toHaveLength(0);
    expect(out.merges).toEqual([]);
    expect(out.results[0]?.reason).toBe('changes protected paths (Cargo.toml), merge it yourself');
  });

  it('starts a session for an open pull request without a protected path', async () => {
    const out = await loop({
      items: [{ id: 74, title: '[PBI] feat: earlier clean pull' }],
      earlierPull: true,
    });
    expect(out.sessions).toHaveLength(1);
    expect(out.merges).toHaveLength(1);
  });

  it('starts no session and merges neither when an issue already has two open pull requests', async () => {
    const out = await loop({
      items: [{ id: 75, title: '[PBI] feat: two pulls' }],
      earlierPull: true,
      twoPulls: [75],
    });
    expect(out.sessions).toHaveLength(0);
    expect(out.merges).toEqual([]);
    expect(out.results[0]?.reason).toBe(
      'more than one open pull request (https://example.test/pull/175, https://example.test/pull/225), merge it yourself',
    );
  });

  it('merges neither pull request when the session left a second one open', async () => {
    const out = await loop({
      items: [{ id: 76, title: '[PBI] feat: second pull' }],
      twoPulls: [76],
    });
    expect(out.sessions).toHaveLength(1);
    expect(out.merges).toEqual([]);
    expect(out.results[0]?.reason).toContain('more than one open pull request');
  });

  it('keeps the reason of a blocked session next to the reason of the guard', async () => {
    const out = await loop({
      items: [{ id: 75, title: '[PBI] feat: blocked' }],
      files: ['Cargo.toml'],
      blocked: 'Dependency review fails',
    });
    const reason =
      'changes protected paths (Cargo.toml) (session: blocked Dependency review fails)';
    expect(out.results[0]?.reason).toBe(`${reason}, merge it yourself`);
    expect(out.log).toContain('Dependency review fails');
  });

  it('names the PBIs that wait for a handed-over pull request', async () => {
    const out = await loop({
      items: [
        { id: 81, title: '[PBI] ci: workflow' },
        { id: 82, title: '[PBI] feat: after it', blockedBy: [81] },
        { id: 83, title: '[PBI] feat: also after it', blockedBy: [81] },
      ],
      files: ['.github/workflows/ci.yml'],
    });
    expect(out.status).toBe(3);
    expect(out.stdout).toMatch(
      /waiting for the handed-over pull request of #81 \(2\):\n {2}#82 blocked by #81\n {2}#83 blocked by #81/,
    );
    expect(out.stdout).toContain('waiting for a handed-over PR: merge it, then run /deliver again');
    expect(out.stdout).not.toMatch(/^blocked$/m);
    expect(out.final).toMatchObject({
      run: 'finished',
      status: 'waiting-for-handed-over',
      handedOver: [81],
      waitingFor: { '81': ['#82 blocked by #81', '#83 blocked by #81'] },
    });
  });

  it('lists a hand-over by rule under needs you, a failure under set aside', async () => {
    const handed = await loop({
      items: [{ id: 62, title: '[PBI] ci: workflow' }],
      files: ['.github/workflows/ci.yml'],
    });
    expect(handed.status).toBe(3);
    expect(handed.stdout).toMatch(/set aside \(0\):/);
    expect(handed.stdout).toMatch(
      /needs you \(1\):\n {2}#62 changes protected paths \(\.github\/workflows\/ci\.yml\), \S+/,
    );
    expect(handed.stdout).toMatch(
      /merge the pull request .* start the loop again with the same arguments/,
    );
    expect(handed.events.find((e) => e.type === 'attention')).toMatchObject({
      reason: 'set-aside',
      needsYou: true,
    });
    expect(handed.events.at(-1)).toMatchObject({ outcome: 'failed', reason: 'incomplete' });
    const failed = await loop({ items: [{ id: 63, title: '[PBI] feat: fails' }], exits: [3] });
    expect(failed.status).toBe(2);
    expect(failed.stdout).toMatch(/set aside \(1\):\n {2}#63 session failed/);
    expect(failed.stdout).toMatch(/needs you \(0\):/);
    expect(failed.stdout).not.toContain('next step: merge');
  });

  it('writes the risk level of the implementer result into results.jsonl and the report', async () => {
    const out = await loop({
      items: [
        { id: 91, title: '[PBI] feat: medium' },
        { id: 92, title: '[PBI] feat: high' },
        { id: 93, title: '[PBI] feat: no result' },
      ],
      risks: { 91: 'medium', 92: 'high' },
    });
    expect(out.status).toBe(0);
    expect(out.results.map((r) => r.risk)).toEqual(['medium', 'high', undefined]);
    expect(out.stdout).toMatch(/#91 \S+ \(risk medium\)/);
    expect(out.stdout).toMatch(/needs you \(1\):\n {2}#92 risk high/);
  });

  it('refuses a base branch without required checks unless the flag allows it', async () => {
    const scenario = { items: [{ id: 71, title: '[PBI] feat: unguarded' }], required: [] };
    const refused = await loop(scenario);
    expect(refused.status).toBe(3);
    expect(refused.stderr).toContain('main requires no checks in fake/repo');
    expect(refused.sessions).toEqual([]);
    const allowed = await loop(scenario, { args: ['--allow-no-required-checks'] });
    expect(allowed.status).toBe(0);
    expect(allowed.merges).toHaveLength(1);
  });

  it('tolerates a failing tracker call during the check wait', async () => {
    const out = await loop({
      items: [{ id: 81, title: '[PBI] feat: flaky' }],
      gates: ['throw', READY],
    });
    expect(out.status).toBe(0);
    expect(out.sessions).toHaveLength(1);
    expect(out.merges).toHaveLength(1);
  });

  it('names the run to the session, so the pull request body can carry it', async () => {
    const out = await loop({ items: [{ id: 103, title: '[PBI] feat: run' }] });
    expect(out.sessions[0]?.run).toMatch(/^\d{8}T\d{6}-\d+$/);
  });

  it('ends a session that printed its final result and stays alive, and goes on to the merge', async () => {
    const out = await loop(
      { items: [{ id: 717, title: '[PBI] feat: lingers' }], lingers: true },
      { env: { DELIVER_RESULT_GRACE_MS: '300' } },
    );
    expect(out.stdout).toContain('ended by the loop');
    expect(out.stdout).toMatch(/#717.*merged/s);
  }, 20_000);

  it('keeps the wakeup tools away from the claude session', () => {
    const argv = HARNESSES.claude.command({ prompt: '/deliver 1' });
    expect(argv.slice(argv.indexOf('--disallowedTools'))).toEqual(
      expect.arrayContaining(['ScheduleWakeup', 'CronCreate']),
    );
  });

  it('builds the copilot command with plain output and no questions', () => {
    const argv = HARNESSES.copilot.command({ prompt: '/deliver 1' });
    expect(argv.slice(0, 3)).toEqual(['copilot', '-p', '/deliver 1']);
    expect(argv).toEqual(expect.arrayContaining(['--no-ask-user', '--no-color']));
    expect(HARNESSES.copilot.claudeStream).toBe(false);
    expect(
      readFileSync(path.resolve(__dirname, '../../../skills/delivery/deliver/SKILL.md'), 'utf8'),
    ).toMatch(/without subagents/);
  });

  it('sets an issue aside when the session ends without a pull request', async () => {
    const out = await loop({ items: [{ id: 91, title: '[PBI] feat: nothing' }], noPull: true });
    expect(out.status).toBe(2);
    expect(out.results[0]?.reason).toBe('session ended without a pull request');
  });

  it('retries a harness failure with a fresh session and merges', async () => {
    const out = await loop(
      {
        items: [{ id: 92, title: '[PBI] feat: flaky' }],
        plan: [{ exit: 1, noPull: true }],
      },
      { env: { DELIVER_TICK_MS: '0.01' } },
    );
    expect(out.status).toBe(0);
    expect(out.sessions).toHaveLength(2);
    expect(out.merges).toHaveLength(1);
    expect(out.log).toMatch(/harness failed \(exit 1, 1 in a row\): waits 5 min/);
  });

  it('ends the run failed with exit 5 at the third harness failure in a row, across PBIs', async () => {
    const fail = { exit: 7, noPull: true };
    const out = await loop(
      {
        items: [
          { id: 93, title: '[PBI] feat: a' },
          { id: 94, title: '[PBI] feat: b' },
        ],
        plan: [fail, { exit: 0 }, fail, fail, fail],
      },
      { env: { DELIVER_TICK_MS: '0.01' } },
    );
    expect(out.status).toBe(5);
    expect(out.sessions).toHaveLength(5);
    expect(out.log.trim().split('\n').at(-1)).toMatch(
      /failed: the harness failed 3 times in a row, last exit code 7/,
    );
    expect(out.events.at(-1)).toMatchObject({ outcome: 'failed', reason: 'harness' });
    expect(out.final).toMatchObject({ status: 'failed' });
  });

  it('gives a session timeout one more session and sets the PBI aside at the second', async () => {
    const env = { DELIVER_SESSION_MS: '250' };
    const once = await loop(
      { items: [{ id: 95, title: '[PBI] feat: slow' }], plan: [{ hangs: true }] },
      { env },
    );
    expect(once.status).toBe(0);
    expect(once.sessions).toHaveLength(2);
    const twice = await loop(
      { items: [{ id: 96, title: '[PBI] feat: slower' }], hangs: true },
      { env },
    );
    expect(twice.status).toBe(2);
    expect(twice.sessions).toHaveLength(2);
    expect(twice.results[0]).toMatchObject({ outcome: 'aside', reason: 'session timeout' });
  }, 20_000);

  it('counts an issue that was set aside in the progress bar of the next one', async () => {
    const out = await loop({
      items: [
        { id: 92, title: '[PBI] feat: first' },
        { id: 93, title: '[PBI] feat: second' },
      ],
      noPull: true,
    });
    expect(out.stdout).toMatch(/#92 start: .*\n.* \[█+░+\] 1 of 2\n/);
    expect(out.stdout).toMatch(/#93 start: .*\n.* \[█{20}\] 2 of 2\n/);
  });

  it('starts no session for an issue whose pull request is already merged', async () => {
    const out = await loop({
      items: [{ id: 92, title: '[PBI] feat: delivered' }],
      mergedBefore: [92],
    });
    expect(out.status).toBe(0);
    expect(out.sessions).toHaveLength(0);
    expect(out.log).toMatch(/#92 merged by someone else/);
    expect(out.results[0]?.outcome).toBe('merged');
  });

  it('counts a pull request merged during the session as merged, not set aside', async () => {
    const out = await loop({
      items: [{ id: 93, title: '[PBI] feat: by hand' }],
      noPull: true,
      mergedDuring: [93],
    });
    expect(out.status).toBe(0);
    expect(out.sessions).toHaveLength(1);
    expect(out.results[0]).toMatchObject({ issue: 93, outcome: 'merged' });
    expect(out.merges).toHaveLength(0);
  });

  it('gives the session the session token as GH_TOKEN and not the variable itself', async () => {
    const withToken = await loop(
      { items: [{ id: 101, title: '[PBI] feat: token' }] },
      { env: { DELIVER_SESSION_TOKEN: 'session-token-value' } },
    );
    expect(withToken.sessions[0]).toMatchObject({
      ghToken: 'session-token-value',
      hasSessionTokenVariable: false,
    });
    expect(withToken.log).not.toContain('session-token-value');
    const without = await loop({ items: [{ id: 102, title: '[PBI] feat: login' }] });
    expect(without.sessions[0]).toMatchObject({
      ghToken: 'login-token',
      hasSessionTokenVariable: false,
    });
    // stdout, not the log: every case of this file appends to the one log of the fixture repository
    expect(without.stdout).toContain('the session uses your own login');
    expect(withToken.stdout).not.toContain('the session uses your own login');
  });

  describe('GitHub App session token', () => {
    const { privateKey, publicKey } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
      publicKeyEncoding: { type: 'spki', format: 'pem' },
    });
    let server: Server;
    let apiUrl = '';
    let requests: { method: string; url: string; body: unknown; jwtValid: boolean }[] = [];
    let minted = 0;
    let lifetimeMs = 3_600_000;

    beforeAll(async () => {
      server = createServer((req, res) => {
        let raw = '';
        req.on('data', (chunk) => {
          raw += chunk;
        });
        req.on('end', () => {
          const [head, claims, signature] = (req.headers.authorization ?? '').slice(7).split('.');
          const jwtValid =
            createVerify('RSA-SHA256')
              .update(`${head}.${claims}`)
              .verify(publicKey, Buffer.from(signature ?? '', 'base64url')) &&
            JSON.parse(Buffer.from(claims, 'base64url').toString()).iss === '4242';
          requests.push({
            method: req.method ?? '',
            url: req.url ?? '',
            body: raw ? JSON.parse(raw) : undefined,
            jwtValid,
          });
          res.setHeader('Content-Type', 'application/json');
          if (req.method === 'GET') res.end(JSON.stringify({ id: 77 }));
          else {
            minted += 1;
            res.end(
              JSON.stringify({
                token: `app-token-${minted}`,
                expires_at: new Date(Date.now() + lifetimeMs).toISOString(),
              }),
            );
          }
        });
      });
      await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready));
      apiUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    });
    afterAll(() => {
      server.close();
    });
    beforeEach(() => {
      requests = [];
      minted = 0;
      lifetimeMs = 3_600_000;
    });

    const keyFile = () => {
      const file = path.join(root, 'app-key.pem');
      writeFileSync(file, privateKey);
      return file;
    };

    it('mints a repository-limited token without workflow or administration permission and hands it to the session', async () => {
      const out = await loop(
        { items: [{ id: 201, title: '[PBI] feat: app' }] },
        {
          env: {
            DELIVER_APP_ID: '4242',
            DELIVER_APP_KEY_FILE: keyFile(),
            DELIVER_APP_API_URL: apiUrl,
          },
        },
      );
      expect(out.status).toBe(0);
      expect(out.sessions[0]).toMatchObject({
        ghToken: 'app-token-1',
        hasSessionTokenVariable: false,
      });
      expect(requests.map((r) => `${r.method} ${r.url}`)).toEqual([
        expect.stringMatching(/^GET \/repos\/.+\/installation$/),
        'POST /app/installations/77/access_tokens',
      ]);
      expect(requests.every((r) => r.jwtValid)).toBe(true);
      const body = requests[1]?.body as { repositories: string[]; permissions: object };
      expect(body.permissions).toEqual(APP_PERMISSIONS);
      expect(Object.keys(body.permissions)).not.toContain('workflows');
      expect(Object.keys(body.permissions)).not.toContain('administration');
      expect(body.repositories).toHaveLength(1);
      // the merge is the tracker's call in the loop process, which has no token of its own
      expect(out.merges).toHaveLength(1);
      expect(out.stdout).not.toContain('the session uses your own login');
    });

    it('reads the key from a command and never writes the key or the token to the log, events or run folder', async () => {
      const command = `node -e "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8'))" "${keyFile()}"`;
      const out = await loop(
        { items: [{ id: 211, title: '[PBI] feat: key command' }] },
        {
          env: {
            DELIVER_APP_ID: '4242',
            DELIVER_APP_KEY_COMMAND: command,
            DELIVER_APP_API_URL: apiUrl,
          },
        },
      );
      expect(out.status).toBe(0);
      const body = privateKey.split('\n')[1] ?? '';
      expect(body.length).toBeGreaterThan(20);
      const results = /results: (\S+)/.exec(out.stdout)?.[1] ?? '';
      const runDir = path.dirname(results);
      const text = [
        out.log,
        out.stdout,
        out.stderr,
        JSON.stringify(out.events),
        ...readdirSync(runDir).map((name) => readFileSync(path.join(runDir, name), 'utf8')),
      ].join('\n');
      expect(text).not.toContain(body);
      expect(text).not.toContain('PRIVATE KEY');
      expect(text).not.toContain('app-token-');
    });

    it('sets the issue aside, without using the login, when the token cannot be minted', async () => {
      const out = await loop(
        { items: [{ id: 221, title: '[PBI] feat: bad key' }] },
        {
          env: {
            DELIVER_APP_ID: '4242',
            DELIVER_APP_KEY_FILE: path.join(root, 'missing.pem'),
            DELIVER_APP_API_URL: apiUrl,
          },
        },
      );
      expect(out.sessions).toHaveLength(0);
      expect(out.status).toBe(2);
      expect(out.stdout).toMatch(/#221 set aside: error: cannot sign with the app key file/);
    });

    it('refuses half-set app settings', async () => {
      const out = await loop(
        { items: [{ id: 231, title: '[PBI] feat: half' }] },
        { env: { DELIVER_APP_KEY_FILE: keyFile() } },
      );
      expect(out.status).toBe(64);
      expect(out.stderr).toContain('DELIVER_APP_ID is missing');
    });

    it('prefers the app over DELIVER_SESSION_TOKEN and reports the source in --dry-run', async () => {
      const out = await loop(
        { items: [{ id: 241, title: '[PBI] feat: dry' }] },
        {
          args: ['--dry-run'],
          env: {
            DELIVER_APP_ID: '4242',
            DELIVER_APP_KEY_FILE: keyFile(),
            DELIVER_SESSION_TOKEN: 'ignored',
          },
        },
      );
      expect(out.stdout).toContain('session token: GitHub App');
      expect(requests).toHaveLength(0);
    });

    it('renews a token when less than the session timeout is left, not before', async () => {
      const settings = appSettings({
        DELIVER_APP_ID: '4242',
        DELIVER_APP_KEY_FILE: keyFile(),
      });
      expect(settings).toBeDefined();
      let n = 0;
      const source = tokenSource(settings!, 'o/r', 90 * 60_000, async () => ({
        token: `t${++n}`,
        expiresAt: Date.now() + 120 * 60_000,
      }));
      const now = Date.now();
      expect(await source.current(now)).toEqual({ token: 't1', renewed: true });
      expect(await source.current(now + 10 * 60_000)).toEqual({ token: 't1', renewed: false });
      expect(await source.current(now + 40 * 60_000)).toEqual({ token: 't2', renewed: true });
    });
  });

  it('prints the order and starts nothing with --dry-run', async () => {
    const out = await loop(
      {
        items: [
          { id: 111, title: '[PBI] feat: a' },
          { id: 112, title: '[PBI] feat: b', blockedBy: [111] },
        ],
      },
      { args: ['--dry-run'] },
    );
    expect(out.status).toBe(0);
    expect(out.stdout).toContain('#111 ready: [PBI] feat: a');
    expect(out.stdout).toContain('#112 blocked by #111: [PBI] feat: b');
    expect(out.stdout).toContain('required checks: ci');
    expect(out.sessions).toEqual([]);
  });

  it.each([
    ['no selection', []],
    ['both selections', ['--milestone', 'M001']],
    ['--max that is no number', ['--max', 'abc']],
    ['an unknown harness', ['--harness', 'nope']],
  ])('ends with a usage error for %s', (_name, args) => {
    const base = args.length === 0 ? [] : ['--issues', '1'];
    let status = 0;
    try {
      execFileSync('node', [loopScript, ...base, ...args], { cwd: repo, stdio: 'pipe' });
    } catch (error) {
      status = (error as { status: number }).status;
    }
    expect(status).toBe(64);
  });
  describe('end of a milestone', () => {
    it('opens the release pull request once everything is merged and reports an open release-test as needs you', async () => {
      const out = await loop(
        { items: [{ id: 31, title: '[PBI] feat: last' }], releaseTests: [39] },
        { milestone: true },
      );
      expect(out.status).toBe(0);
      expect(out.merges).toHaveLength(1);
      expect(out.releasePulls).toBe(1);
      expect(out.stdout).toContain('release pull request: https://example.test/pull/900');
      expect(out.stdout).toMatch(/needs you \(1\):\n {2}#39 /);
      // a milestone is delivered into release/next
      expect(out.sessions[0]?.prompt).toMatch(/^\/deliver 31 --base release\/next /);
      expect(out.sessions.map((s) => s.prompt).join('\n')).not.toContain('/deliver 39');
      expect(out.events.find((e) => e.type === 'attention')).toMatchObject({
        reason: 'release-test',
        needsYou: true,
      });
      // the release pull request is never merged
      expect(out.merges.map((m) => m.pull)).not.toContain(900);
    });

    it('opens no release pull request for a milestone without open issues and without commits', async () => {
      const out = await loop({ items: [], releaseCommits: 0 }, { milestone: true });
      expect(out.status).toBe(0);
      expect(out.releasePulls).toBe(0);
      expect(out.stdout).toContain('nothing to deliver');
      expect(out.stdout).not.toContain('release pull request failed');
      expect(out.events.find((e) => e.type === 'run.finished')).toMatchObject({
        outcome: 'succeeded',
      });
    });

    it('does none of this with an issue set aside or waiting', async () => {
      const aside = await loop(
        { items: [{ id: 41, title: '[PBI] feat: fails' }], exits: [3], releaseTests: [49] },
        { milestone: true },
      );
      expect(aside.releasePulls).toBe(0);
      expect(aside.stdout).not.toContain('needs you (1)');
      expect(aside.events.some((e) => e.type === 'attention' && e.reason === 'release-test')).toBe(
        false,
      );
      const waiting = await loop(
        { items: [{ id: 43, title: '[PBI] feat: blocked', blockedBy: [42] }], releaseTests: [49] },
        { milestone: true },
      );
      expect(waiting.releasePulls).toBe(0);
    });

    it('takes an explicit base before release/next', async () => {
      const out = await loop(
        { items: [{ id: 45, title: '[PBI] feat: one' }] },
        { milestone: true, args: ['--base', 'main', '--dry-run'] },
      );
      expect(out.stdout).toContain('tracker: fake, base: main');
    });

    it('does not open it with --issues', async () => {
      const out = await loop({ items: [{ id: 51, title: '[PBI] feat: one' }] });
      expect(out.releasePulls).toBe(0);
    });
  });

  describe('missing base branch', () => {
    const originRef = () =>
      execFileSync('git', ['ls-remote', '--heads', path.join(root, 'origin.git'), 'release/next'], {
        encoding: 'utf8',
      }).trim();
    afterEach(() => {
      if (!originRef()) git(repo, 'push', '--quiet', 'origin', 'main:release/next');
    });

    it('cuts release/next from the default branch', async () => {
      git(repo, 'push', '--quiet', 'origin', ':release/next');
      expect(originRef()).toBe('');
      const out = await loop(
        { items: [{ id: 61, title: '[PBI] feat: one' }] },
        { milestone: true },
      );
      expect(out.status).toBe(0);
      expect(out.stdout).toContain('release/next was missing on origin: cut from main');
      expect(out.log).toContain('release/next was missing on origin: cut from main');
      expect(originRef()).not.toBe('');
      expect(out.merges).toHaveLength(1);
    });

    it('stays an error for another base', async () => {
      const out = await loop(
        { items: [{ id: 62, title: '[PBI] feat: one' }] },
        { args: ['--base', 'release/other'] },
      );
      expect(out.status).toBe(3);
      expect(out.stderr).toContain('release/other is missing on origin');
    });
  });
});

describe('mergedPullSince of the GitHub tracker', () => {
  const pr = (
    number: number,
    ref: string,
    merged_at: string | null,
    full_name = 'o/r',
    body = 'Closes #7',
  ) => ({
    number,
    title: 't',
    html_url: `u${number}`,
    head: { ref, repo: { full_name } },
    merged_at,
    body,
  });
  const since = '2026-11-10T00:00:00Z';

  it('finds the pull request merged after the issue was opened', () => {
    const found = mergedPullSince([pr(5, 'feat/7-x', '2026-11-16T11:00:00Z')], 'o/r', 7, since);
    expect(found?.number).toBe(5);
  });

  it('ignores an old merged pull request of a reopened issue', () => {
    expect(
      mergedPullSince([pr(5, 'feat/7-x', '2026-11-01T11:00:00Z')], 'o/r', 7, since),
    ).toBeUndefined();
  });

  it('ignores closed unmerged, other issues, other numbers with the same prefix and forks', () => {
    const records = [
      pr(1, 'feat/7-x', null),
      pr(2, 'feat/8-x', '2026-11-16T11:00:00Z'),
      pr(3, 'feat/70-x', '2026-11-16T11:00:00Z'),
      pr(4, 'feat/7-x', '2026-11-16T11:00:00Z', 'fork/r'),
    ];
    expect(mergedPullSince(records, 'o/r', 7, since)).toBeUndefined();
  });
});

describe('a merged pull request that does not close the issue', () => {
  const rec = (body: string | null) => ({
    number: 43,
    title: 'docs: adr (#7)',
    html_url: 'u43',
    head: { ref: 'docs/7-adr', repo: { full_name: 'o/r' } },
    merged_at: '2026-11-16T11:00:00Z',
    body,
  });
  const since = '2026-11-10T00:00:00Z';

  it('is no delivery of the issue', () => {
    expect(mergedPullSince([rec('ADR for #7')], 'o/r', 7, since)).toBeUndefined();
    expect(mergedPullSince([rec(null)], 'o/r', 7, since)).toBeUndefined();
  });

  it('is a delivery with a closing keyword or a closing reference', () => {
    expect(mergedPullSince([rec('Closes #7')], 'o/r', 7, since)?.number).toBe(43);
    expect(mergedPullSince([rec('no keyword')], 'o/r', 7, since, () => true)?.number).toBe(43);
  });

  it('reads closing keywords exactly', () => {
    expect(closesIssue('fixes #7.', 7)).toBe(true);
    expect(closesIssue('Resolved: #7', 7)).toBe(true);
    expect(closesIssue('Closes #70', 7)).toBe(false);
    expect(closesIssue('see #7', 7)).toBe(false);
  });
});

describe('openPullsOf of the GitHub tracker', () => {
  const pr = (number: number, ref: string, full_name = 'o/r') => ({
    number,
    title: 't',
    html_url: `u${number}`,
    head: { ref, repo: { full_name } },
  });

  it('returns both open pull requests of one issue with different slugs, the oldest first', () => {
    const records = [
      pr(139, 'chore/137-release-test-tauri-dev-setup'),
      pr(138, 'chore/137-release-test-tauri-dev'),
    ];
    expect(openPullsOf(records, 'o/r', 137).map((p) => p.number)).toEqual([138, 139]);
  });

  it('ignores other issues, other numbers with the same prefix and forks', () => {
    const records = [pr(1, 'feat/8-x'), pr(2, 'feat/70-x'), pr(3, 'feat/7-x', 'fork/r')];
    expect(openPullsOf(records, 'o/r', 7)).toEqual([]);
  });
});

describe('checkVerdict of the GitHub tracker', () => {
  const pass = (name: string) => ({ name, bucket: 'pass' });
  it.each([
    ['every required check passed', ['ci', 'pr'], [pass('ci'), pass('pr')], 'green'],
    ['a required check has not reported', ['ci', 'pr'], [pass('pr')], 'pending'],
    ['a required check still runs', ['ci'], [{ name: 'ci', bucket: 'pending' }], 'pending'],
    ['no check has reported', ['ci'], [], 'pending'],
    ['a required check was skipped', ['ci'], [{ name: 'ci', bucket: 'skipping' }], 'green'],
    [
      'a check that is not required failed',
      ['ci'],
      [pass('ci'), { name: 'codeql', bucket: 'fail' }],
      'green',
    ],
    [
      'a check that is not required still runs',
      ['ci'],
      [pass('ci'), { name: 'codeql', bucket: 'pending' }],
      'green',
    ],
    ['a required check was cancelled', ['ci'], [{ name: 'ci', bucket: 'cancel' }], 'pending'],
    [
      'without required checks every reported check counts',
      [],
      [pass('a'), { name: 'b', bucket: 'pending' }],
      'pending',
    ],
    ['without required checks all passed', [], [pass('a'), pass('b')], 'green'],
  ])('%s', (_name, required, checks, state) => {
    expect(checkVerdict(required, checks).state).toBe(state);
  });

  it('names each failed required check once', () => {
    const fail = { name: 'ci', bucket: 'fail' };
    expect(checkVerdict(['ci', 'pr'], [fail, fail, pass('pr')])).toEqual({
      state: 'red',
      detail: 'ci',
    });
    expect(checkVerdict([], [{ name: 'lint', bucket: 'fail' }])).toEqual({
      state: 'red',
      detail: 'lint',
    });
  });
});

describe('starting the harness on Windows', () => {
  const dirs = 'C:\\Tools;C:\\npm';
  const has =
    (...files: string[]) =>
    (file: string) =>
      files.includes(file);

  it('finds the .cmd shim through PATHEXT', () => {
    expect(resolveWindows('claude', dirs, '.COM;.EXE;.CMD', has('C:\\npm\\claude.CMD'))).toBe(
      'C:\\npm\\claude.CMD',
    );
    expect(resolveWindows('claude', dirs, '.EXE', has())).toBeUndefined();
  });

  it('runs a shim through cmd.exe with every argument quoted', () => {
    const env = { PATH: dirs, PATHEXT: '.EXE;.CMD', ComSpec: 'C:\\Windows\\cmd.exe' };
    expect(cmdLine(['C:\\npm\\claude.CMD', '-p', 'a "b" & c'])).toBe(
      '""C:\\npm\\claude.CMD" "-p" "a ""b"" & c""',
    );
    expect(() => cmdLine(['x', '%PATH%'])).toThrow(/not usable/);
    // the shim is not on this machine: the plain name is passed on, no cmd.exe
    expect(launchCommand(['claude', '-p'], 'win32', env)).toEqual({
      file: 'claude',
      args: ['-p'],
      verbatim: false,
    });
    expect(launchCommand(['claude', '-p'], 'linux', env).file).toBe('claude');
  });

  it('writes the issue file path with forward slashes, quoted when it holds a space', () => {
    expect(promptPath('C:\\work\\run\\11.issue.md')).toBe('C:/work/run/11.issue.md');
    expect(promptPath('C:\\Users\\Jane Doe\\11.issue.md')).toBe('"C:/Users/Jane Doe/11.issue.md"');
  });
});

describe('deliver SKILL.md branch update rule', () => {
  const text = readFileSync(path.join(skill, 'SKILL.md'), 'utf8');
  it('tells the session to merge the base, never rebase or force-push', () => {
    expect(text).toContain('git merge origin/<base>');
    expect(text).toMatch(/Never rebase and never force-push/);
  });
});
