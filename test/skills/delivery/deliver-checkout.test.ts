// deliver: the checkouts of an Objective run (checkout.mts), against local bare repositories, and one run of the
// repository loop whose root is such a clone.
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as Checkout from '../../../skills/delivery/deliver/scripts/checkout.mts';
import { git, lines, skill } from './deliver/run-loop';

const load = (name: string) => import(pathToFileURL(path.join(skill, 'scripts', name)).href);
const { cloneCheckouts, tokenEnv } = (await load('checkout.mts')) as typeof Checkout;

let tmp: string;
let seed: string;
const origin = (repo: string) => path.join(tmp, 'origin', `${repo}.git`);
const checkouts = (runRoot: string, token?: (repo: string) => Promise<string | undefined>) =>
  cloneCheckouts({ runRoot, url: origin, ...(token && { token }) });
const commit = (message: string): string => {
  writeFileSync(path.join(seed, 'README.md'), `${message}\n`);
  git(seed, 'add', 'README.md');
  git(seed, 'commit', '--quiet', '-m', message);
  return git(seed, 'rev-parse', 'HEAD').trim();
};

beforeAll(() => {
  // the real path: git names worktrees by it, a temp directory is often a symlink
  tmp = realpathSync.native(mkdtempSync(path.join(tmpdir(), 'checkout-')));
  seed = path.join(tmp, 'seed');
  execFileSync('git', ['init', '--quiet', '--bare', '--initial-branch', 'main', origin('o/app')]);
  execFileSync('git', ['init', '--quiet', '--initial-branch', 'main', seed]);
  commit('chore: fixture');
  git(seed, 'remote', 'add', 'origin', origin('o/app'));
  git(seed, 'push', '--quiet', 'origin', 'main', 'main:release/next', 'main:gone');
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('checkout()', () => {
  it('clones on first use into <run-root>/repos/<owner>/<repo> and fetches later', async () => {
    const runRoot = path.join(tmp, 'reuse');
    const { checkout } = checkouts(runRoot);
    const root = path.join(runRoot, 'repos', 'o', 'app');
    expect(await checkout('o/app')).toEqual({ repo: 'o/app', root });
    expect(git(root, 'rev-parse', '--is-bare-repository').trim()).toBe('true');
    // no local branch: a session creates its branch, cleanup() deletes it
    expect(git(root, 'for-each-ref', 'refs/heads')).toBe('');
    expect(git(root, 'rev-parse', 'origin/gone')).toBeTruthy();
    // a second clone would not keep this file
    writeFileSync(path.join(root, 'kept'), '');

    const head = commit('feat: more');
    git(seed, 'push', '--quiet', 'origin', 'main:release/next', ':gone');
    expect(await checkouts(runRoot).checkout('o/app')).toEqual({ repo: 'o/app', root });
    expect(existsSync(path.join(root, 'kept'))).toBe(true);
    expect(git(root, 'rev-parse', 'origin/release/next').trim()).toBe(head);
    expect(() => git(root, 'rev-parse', '--verify', 'origin/gone')).toThrow();
  });

  it('makes a failed clone a needs-you reason of that repository only, and leaves nothing', async () => {
    const runRoot = path.join(tmp, 'failed');
    const { checkout } = checkouts(runRoot);
    const [missing, app] = await Promise.all([checkout('o/missing'), checkout('o/app')]);
    expect(missing).toEqual({
      repo: 'o/missing',
      needsYou: expect.stringMatching(/^o\/missing: clone failed: fatal: /),
    });
    expect(app).toHaveProperty('root');
    expect(readdirSync(path.join(runRoot, 'repos', 'o'))).toEqual(['app']);
  });

  it('makes a failed fetch a needs-you reason and keeps the clone', async () => {
    const runRoot = path.join(tmp, 'offline');
    await checkouts(runRoot).checkout('o/app');
    const root = path.join(runRoot, 'repos', 'o', 'app');
    git(root, 'remote', 'set-url', 'origin', origin('o/missing'));
    expect(await checkouts(runRoot).checkout('o/app')).toEqual({
      repo: 'o/app',
      needsYou: expect.stringMatching(/^o\/app: fetch failed: /),
    });
    expect(existsSync(path.join(root, 'HEAD'))).toBe(true);
  });

  it.each(['app', '../app', 'o/..', 'o/app/more'])('refuses the name %s', async (name) => {
    const runRoot = path.join(tmp, 'names');
    expect(await checkouts(runRoot).checkout(name)).toEqual({
      repo: name,
      needsYou: `${name}: not a repository name`,
    });
    expect(existsSync(runRoot)).toBe(false);
  });

  it('asks for the token of the repository and fails without falling back to the login', async () => {
    const asked: string[] = [];
    const given = checkouts(path.join(tmp, 'login'), async (repo) => {
      asked.push(repo);
      return undefined;
    });
    expect(await given.checkout('o/app')).toHaveProperty('root');
    expect(asked).toEqual(['o/app']);
    const failing = checkouts(path.join(tmp, 'mint'), async () => {
      throw new Error('mint failed');
    });
    expect(await failing.checkout('o/app')).toEqual({
      repo: 'o/app',
      needsYou: 'o/app: clone failed: mint failed',
    });
    expect(existsSync(path.join(tmp, 'mint', 'repos', 'o', 'app'))).toBe(false);
  });

  it('gives git the token as a header of that host only, with no other credentials', () => {
    const env = tokenEnv('https://github.com/o/app.git', 'secret', {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'user.name',
      GIT_CONFIG_VALUE_0: 'kept',
    });
    const config = (...args: string[]) =>
      execFileSync('git', ['config', ...args], { cwd: tmp, env, encoding: 'utf8' }).trim();
    const basic = Buffer.from('x-access-token:secret').toString('base64');
    expect(config('--get-urlmatch', 'http.extraheader', 'https://github.com/o/app.git')).toBe(
      `AUTHORIZATION: basic ${basic}`,
    );
    expect(config('--get', 'credential.helper')).toBe('');
    expect(config('user.name')).toBe('kept');
    expect(env.GIT_ASKPASS).toBe('');
  });
});

describe('a run whose root is a cached clone', () => {
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('creates the worktrees from the clone and cleanup() removes them', async () => {
    const dir = path.join(tmp, 'case');
    mkdirSync(dir);
    writeFileSync(
      path.join(dir, 'scenario.json'),
      JSON.stringify({ items: [{ id: 1, title: '[PBI] feat: one' }] }),
    );
    // the head of every pull request of the fake tracker
    git(seed, 'tag', '--force', 'abc123', 'origin/release/next');
    git(seed, 'push', '--quiet', '--force', 'origin', 'abc123');
    const runRoot = path.join(tmp, 'run');
    const checked = await checkouts(runRoot).checkout('o/app');
    if (!('root' in checked)) throw new Error(checked.needsYou);
    const { root } = checked;

    vi.stubEnv('FAKE_DIR', dir);
    vi.stubEnv('HOME', dir);
    vi.stubEnv('USERPROFILE', dir);
    vi.stubEnv('DELIVER_TICK_MS', '1');
    vi.stubEnv('DELIVER_TRACKER_DIR', path.join(__dirname, 'deliver', 'tracker'));
    const { runRepository } = await load('run-repository.mts');
    const { loadTracker } = await load('tracker.mts');
    const { HARNESSES } = await load('harness.mts');
    const { reviewSettings, retroSettings } = await load('review.mts');
    const { sessionModels } = await load('session-models.mts');
    const { StopSignal } = await load('stop-signal.mts');
    const tracker = await loadTracker('fake', { selection: { issues: ['1'] } });
    const runDir = path.join(runRoot, 'run-1');
    mkdirSync(runDir, { recursive: true });
    const said: string[] = [];
    const say = (line: string) => said.push(line);
    const result = await runRepository({
      root,
      options: {
        issues: '1',
        base: 'release/next',
        dryRun: false,
        allowNoRequiredChecks: false,
        max: 0,
        sessionMinutes: 1,
        mergeMinutes: 1,
        handoverMinutes: 0,
        mergeRisk: 'medium',
        harnessName: 'claude',
        harness: HARNESSES.claude,
        review: reviewSettings({
          flags: {},
          config: undefined,
          implementer: { harnessName: 'claude' },
        }),
        models: sessionModels({ layers: [], harness: 'claude', reviewHarness: 'claude' }),
        retro: retroSettings({ disabled: true, config: undefined, defaultModel: 'sonnet' }),
        protectedPaths: [],
        harnessOverride: ['node', path.join(__dirname, 'deliver', 'fake-harness.mjs'), dir],
      },
      tracker,
      token: {},
      runId: 'run-1',
      runDir,
      events: {
        open: () => ({ run: 'run-1', dir: undefined, origin: { repo: 'o/app' } }),
        emit: () => {},
      },
      status: () => {},
      signal: new StopSignal(),
      out: { say, log: say, toFile: () => {} },
    });

    expect(result.merged, said.join('\n')).toHaveLength(1);
    const worktree = `${root}-wt-1`;
    const [session] = lines<{ cwd: string }>(path.join(dir, 'sessions.jsonl'));
    const [review] = lines<{ cwd: string }>(path.join(dir, 'reviews.jsonl'));
    expect(path.resolve(session?.cwd ?? '')).toBe(worktree);
    expect(path.resolve(review?.cwd ?? '')).toBe(`${worktree}-review`);
    // only the clone itself is left
    expect(readdirSync(path.dirname(root))).toEqual(['app']);
    expect(git(root, 'worktree', 'list', '--porcelain').match(/^worktree /gm)).toHaveLength(1);
    expect(readFileSync(path.join(runDir, 'results.jsonl'), 'utf8')).toContain('"merged"');
  });
});
