// Gate `merge-approved` (#1158): one merge attempt that merges only the reviewed commit, in-process over a fake
// tracker and as a CLI over the fake tracker of the loop tests.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  CLOSED,
  type MergeApprovedInput,
  mergeApproved,
} from '../../../skills/delivery/deliver/scripts/gates/merge-approved.mts';
import {
  type GateResult,
  UsageError,
  runGate,
} from '../../../skills/delivery/deliver/scripts/gates/result.mts';
import type { Gate } from '../../../skills/delivery/deliver/scripts/tracker.mts';

const skill = path.resolve(__dirname, '../../../skills/delivery/deliver');
const script = path.join(skill, 'scripts/gates/merge-approved.mts');

const SHA = 'abc123';
const PULL = { id: 7, title: 'feat: x', url: 'https://example.test/pull/7', branch: 'feat/1-x' };
const APPROVED: GateResult = { result: 'pass', reason: 'approved', evidence: { head: SHA } };
const PASS: GateResult = { result: 'pass', reason: 'guarded', evidence: {} };

/** A tracker whose gate answers `gate` (an Error throws) and that records every merge. */
function fake(gate: Gate | Error = { state: 'ready', reported: true, head: SHA }, refuse?: string) {
  const merges: string[] = [];
  const guards: string[] = [];
  let gates = 0;
  const input = (extra: Partial<MergeApprovedInput> = {}): MergeApprovedInput => ({
    tracker: {
      gate: () => {
        gates++;
        if (gate instanceof Error) throw gate;
        return gate;
      },
      merge: (_pull, head) => {
        if (refuse) throw new Error(refuse);
        merges.push(head);
      },
    },
    pull: PULL,
    sha: SHA,
    verdict: APPROVED,
    guard: (head) => {
      guards.push(head);
      return PASS;
    },
    ...extra,
  });
  return { input, merges, guards, gates: () => gates };
}

describe('mergeApproved', () => {
  it('merges the reviewed commit and nothing else', async () => {
    const t = fake();
    await expect(mergeApproved(t.input())).resolves.toEqual({
      result: 'pass',
      reason: `merged ${SHA}`,
      evidence: { pr: 7, sha: SHA },
    });
    expect(t.merges).toEqual([SHA]);
    expect(t.guards).toEqual([SHA]);
  });

  it('passes an already merged pull request without merging', async () => {
    const t = fake({ state: 'merged' });
    await expect(mergeApproved(t.input())).resolves.toMatchObject({ result: 'pass' });
    expect(t.merges).toEqual([]);
  });

  it.each([
    ['no verdict', undefined],
    ['a verdict that asks for changes', { result: 'fail', reason: 'changes', evidence: {} }],
    ['a verdict that is no result', { result: 'usage', reason: 'x', evidence: {} }],
  ] as [string, GateResult | undefined][])(
    'hands %s to the owner without reading the gate',
    async (_name, verdict) => {
      const t = fake();
      const out = await mergeApproved(t.input({ verdict }));
      expect(out).toMatchObject({
        result: 'owner',
        reason: expect.stringMatching(/^no approving verdict .*, merge it yourself$/),
      });
      expect(t.gates()).toBe(0);
      expect(t.merges).toEqual([]);
    },
  );

  it('hands an approval of another commit to the owner', async () => {
    const t = fake();
    const verdict = { ...APPROVED, evidence: { head: 'def456' } };
    await expect(mergeApproved(t.input({ verdict }))).resolves.toMatchObject({
      result: 'owner',
      evidence: { verdictHead: 'def456' },
    });
    expect(t.merges).toEqual([]);
  });

  it('hands a push after the review to the owner, unguarded and unmerged', async () => {
    const t = fake({ state: 'ready', reported: true, head: 'def456' });
    await expect(mergeApproved(t.input())).resolves.toEqual({
      result: 'owner',
      reason: 'pushed after the review, merge it yourself',
      evidence: { pr: 7, sha: SHA, prHead: 'def456' },
    });
    expect(t.guards).toEqual([]);
    expect(t.merges).toEqual([]);
  });

  it('retries pending checks and checks that have not reported, with evidence.reported', async () => {
    const pending = fake({ state: 'pending', reported: true, head: SHA });
    await expect(mergeApproved(pending.input())).resolves.toMatchObject({
      result: 'retry',
      evidence: { reported: true },
    });
    const silent = fake({ state: 'ready', reported: false, head: SHA });
    await expect(mergeApproved(silent.input())).resolves.toMatchObject({
      result: 'retry',
      evidence: { reported: false },
    });
    expect([...pending.merges, ...silent.merges]).toEqual([]);
  });

  it('merges a gate without reported checks once the executor says it waited long enough', async () => {
    const t = fake({ state: 'ready', reported: false, head: SHA });
    await expect(mergeApproved(t.input({ unreportedOk: true }))).resolves.toMatchObject({
      result: 'pass',
    });
    expect(t.merges).toEqual([SHA]);
  });

  it('retries a failing tracker read with the error in the evidence', async () => {
    const t = fake(new Error('network down\nmore'));
    await expect(mergeApproved(t.input())).resolves.toMatchObject({
      result: 'retry',
      reason: 'tracker error: network down',
      evidence: { error: 'network down' },
    });
  });

  it.each([
    [{ state: 'closed' }, CLOSED, {}],
    [{ state: 'conflict', detail: 'conflict with main' }, 'conflict with main', { conflict: true }],
    [{ state: 'red', detail: 'ci' }, 'red: ci', {}],
  ] as [Gate, string, object][])('fails a %o gate', async (gate, reason, evidence) => {
    const t = fake(gate);
    await expect(mergeApproved(t.input())).resolves.toMatchObject({
      result: 'fail',
      reason,
      evidence,
    });
    expect(t.merges).toEqual([]);
  });

  it('fails a merge the tracker refuses', async () => {
    const t = fake(undefined, 'Head branch was modified');
    await expect(mergeApproved(t.input())).resolves.toMatchObject({
      result: 'fail',
      reason: 'merge refused: Head branch was modified',
      evidence: { refused: true },
    });
  });

  it('hands a guard that does not pass to the owner', async () => {
    const t = fake();
    const guard = () =>
      ({
        result: 'owner',
        reason: 'changes protected paths (.claude/x), merge it yourself',
        evidence: { hits: ['.claude/x'] },
      }) as GateResult;
    await expect(mergeApproved(t.input({ guard }))).resolves.toEqual({
      result: 'owner',
      reason: 'changes protected paths (.claude/x), merge it yourself',
      evidence: { pr: 7, sha: SHA, guard: { hits: ['.claude/x'] } },
    });
    const failed = () => ({ result: 'fail', reason: 'tracker: down', evidence: {} }) as GateResult;
    await expect(mergeApproved(t.input({ guard: failed }))).resolves.toMatchObject({
      result: 'owner',
      reason: 'guard fail: tracker: down, merge it yourself',
    });
    expect(t.merges).toEqual([]);
  });

  it('hands a guard that throws to the owner, but passes a usage error on', async () => {
    const t = fake();
    const thrown = () => {
      throw new Error('boom');
    };
    await expect(mergeApproved(t.input({ guard: thrown }))).resolves.toMatchObject({
      result: 'owner',
      reason: 'guard failed (boom), merge it yourself',
    });
    const usage = () => {
      throw new UsageError('wrong tracker');
    };
    await expect(mergeApproved(t.input({ guard: usage }))).rejects.toThrow('wrong tracker');
    expect(t.merges).toEqual([]);
  });

  it('ends at a checkpoint before the guard or before the merge without merging', async () => {
    const stop: GateResult = { result: 'retry', reason: 'stopped', evidence: { stopped: true } };
    for (const at of [1, 2]) {
      const t = fake();
      let calls = 0;
      const checkpoint = () => (++calls === at ? stop : undefined);
      await expect(mergeApproved(t.input({ checkpoint }))).resolves.toBe(stop);
      expect(t.guards).toEqual(at === 1 ? [] : [SHA]);
      expect(t.merges).toEqual([]);
    }
  });

  it('lets a stop seen after the guard win over its hand-over', async () => {
    const t = fake();
    const stop: GateResult = { result: 'retry', reason: 'stopped', evidence: { stopped: true } };
    let calls = 0;
    const out = await mergeApproved(
      t.input({
        guard: () => ({ result: 'owner', reason: 'risk high, merge it yourself', evidence: {} }),
        checkpoint: () => (++calls === 2 ? stop : undefined),
      }),
    );
    expect(out).toBe(stop);
  });
});

describe('merge-approved CLI', () => {
  let repo: string;
  let fakeDir: string;
  let verdictFile: string;
  const tracker = path.resolve(__dirname, 'deliver/tracker');
  const approve = JSON.stringify({ verdict: 'approve', findings: [], unmet: [] });

  beforeAll(() => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gate-merge-approved-'));
    repo = path.join(dir, 'repo');
    fakeDir = path.join(dir, 'fake');
    verdictFile = path.join(dir, 'verdict.json');
    mkdirSync(path.join(repo, '.agents'), { recursive: true });
    mkdirSync(fakeDir);
    execFileSync('git', ['init', '-q', repo]);
  });
  afterAll(() => rmSync(path.dirname(repo), { recursive: true, force: true }));

  const merges = (): { pull: number; head: string; base: string; title: string }[] => {
    const file = path.join(fakeDir, 'merges.jsonl');
    return existsSync(file)
      ? readFileSync(file, 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  };

  /** `deliver` is the config at the merge base; `head` the one the pull request and the checkout bring. */
  const run = (
    args: string[],
    {
      scenario = {},
      deliver = {},
      head,
      verdict = approve,
    }: { scenario?: object; deliver?: object; head?: object; verdict?: string | null } = {},
  ) => {
    const config = (value: object | undefined) =>
      value === undefined ? undefined : JSON.stringify({ deliver: value });
    writeFileSync(path.join(repo, '.agents/config.json'), config(head) ?? '{}');
    rmSync(path.join(fakeDir, 'merges.jsonl'), { force: true });
    rmSync(verdictFile, { force: true });
    if (verdict !== null) writeFileSync(verdictFile, verdict);
    writeFileSync(
      path.join(fakeDir, 'scenario.json'),
      JSON.stringify({
        items: [],
        projectConfig: { base: config(deliver), head: config(head) },
        ...scenario,
      }),
    );
    return runGate(script, ['--tracker', 'fake', ...args], {
      cwd: repo,
      env: {
        ...process.env,
        DELIVER_TRACKER_DIR: tracker,
        FAKE_DIR: fakeDir,
        DELIVER_TICK_MS: '1',
      },
    });
  };
  const withVerdict = (...args: string[]) => [...args, '--verdict', verdictFile];

  it('merges <sha> into the base of the pull request with its title', async () => {
    await expect(run(withVerdict('7', SHA))).resolves.toEqual({
      result: 'pass',
      reason: `merged ${SHA}`,
      evidence: { base: 'release/next', pr: 7, sha: SHA },
    });
    expect(merges()).toEqual([{ pull: 7, head: SHA, base: 'release/next', title: 'fake #7' }]);
  });

  it('merges nothing without a verdict file', async () => {
    await expect(run(withVerdict('7', SHA), { verdict: null })).resolves.toMatchObject({
      result: 'owner',
      reason: 'no approving verdict (no verdict), merge it yourself',
    });
    await expect(run(['7', SHA])).resolves.toMatchObject({ result: 'usage' });
    expect(merges()).toEqual([]);
  });

  it.each([
    [
      'asks for changes',
      JSON.stringify({ verdict: 'changes', findings: [], unmet: ['AC 1'] }),
      'the review asks for changes',
    ],
    ['is no verdict', '{"verdict":"yes"}', 'invalid verdict'],
  ])('merges nothing when the verdict %s', async (_name, verdict, why) => {
    await expect(run(withVerdict('7', SHA), { verdict })).resolves.toMatchObject({
      result: 'owner',
      reason: `no approving verdict (${why}), merge it yourself`,
    });
    expect(merges()).toEqual([]);
  });

  it('merges nothing when the pull request is not at <sha>', async () => {
    await expect(run(withVerdict('7', 'def456'))).resolves.toMatchObject({
      result: 'owner',
      reason: 'pushed after the review, merge it yourself',
      evidence: { prHead: SHA },
    });
    expect(merges()).toEqual([]);
  });

  it('runs the guard with the config at the merge base, not the one of the checkout', async () => {
    const out = await run(withVerdict('7', SHA), {
      scenario: { files: ['.github/workflows/x.yml'] },
      head: { protectedPaths: [], mergeRisk: 'high' },
    });
    expect(out).toMatchObject({
      result: 'owner',
      reason: 'changes protected paths (.github/workflows/x.yml), merge it yourself',
      evidence: { guard: { head: SHA, base: 'base-sha' } },
    });
    expect(merges()).toEqual([]);
  });

  it('hands a risk above the merge risk of the base config to the owner', async () => {
    await expect(
      run(withVerdict('7', SHA, '--risk', 'high'), { head: { mergeRisk: 'high' } }),
    ).resolves.toMatchObject({ result: 'owner', reason: 'risk high, merge it yourself' });
    await expect(
      run(withVerdict('7', SHA, '--risk', 'high'), { deliver: { mergeRisk: 'high' } }),
    ).resolves.toMatchObject({ result: 'pass' });
  });

  it('merges nothing when the pull request is retargeted during the attempt', async () => {
    const out = await run(withVerdict('7', SHA), {
      scenario: { pullBases: ['release/next', 'main'] },
    });
    expect(out).toMatchObject({
      result: 'owner',
      reason: 'base changed from release/next to main, merge it yourself',
    });
    expect(merges()).toEqual([]);
  });

  it('retries pending checks and merges unreported ones only with --unreported-ok', async () => {
    const pending = { gates: [{ state: 'pending', reported: true, head: SHA }] };
    await expect(run(withVerdict('7', SHA), { scenario: pending })).resolves.toMatchObject({
      result: 'retry',
      evidence: { reported: true },
    });
    const silent = { gates: [{ state: 'ready', reported: false, head: SHA }] };
    await expect(run(withVerdict('7', SHA), { scenario: silent })).resolves.toMatchObject({
      result: 'retry',
      evidence: { reported: false },
    });
    expect(merges()).toEqual([]);
    await expect(
      run(withVerdict('7', SHA, '--unreported-ok'), { scenario: silent }),
    ).resolves.toMatchObject({ result: 'pass' });
  });

  it('fails a merge the tracker refuses', async () => {
    await expect(
      run(withVerdict('7', SHA), { scenario: { mergeRefused: 'sha mismatch' } }),
    ).resolves.toMatchObject({
      result: 'fail',
      reason: 'merge refused: sha mismatch',
      evidence: { refused: true },
    });
  });

  it('reports a base config that names another tracker as usage, unmerged', async () => {
    await expect(
      run(withVerdict('7', SHA), { deliver: { tracker: 'github' } }),
    ).resolves.toMatchObject({
      result: 'usage',
      reason: expect.stringContaining('--tracker github'),
    });
    expect(merges()).toEqual([]);
  });

  it.each([
    ['no sha', ['7', '--verdict', 'v.json']],
    ['a sha that is no commit id', ['7', 'HEAD', '--verdict', 'v.json']],
    ['a pull request that is no number', ['x', SHA, '--verdict', 'v.json']],
    ['a risk that is no level', ['7', SHA, '--verdict', 'v.json', '--risk', 'huge']],
    ['both risk sources', ['7', SHA, '--verdict', 'v.json', '--risk', 'low', '--result-file', 'r']],
    ['an unknown flag', ['7', SHA, '--verdict', 'v.json', '--nope']],
  ])('reports %s as usage', async (_name, args) => {
    await expect(run(args)).resolves.toMatchObject({ result: 'usage' });
    expect(merges()).toEqual([]);
  });

  it('refuses a tracker directory inside the repository', async () => {
    const out = await runGate(script, withVerdict('7', SHA, '--tracker', 'fake'), {
      cwd: repo,
      env: { ...process.env, DELIVER_TRACKER_DIR: path.join(repo, '.agents'), FAKE_DIR: fakeDir },
    });
    expect(out).toMatchObject({
      result: 'usage',
      reason: 'DELIVER_TRACKER_DIR must not be inside the repository',
    });
  });
});

describe('pullRequest of the GitHub tracker', () => {
  const oldPath = process.env.PATH;
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'merge-approved-gh-'));
    const record = JSON.stringify({
      number: 7,
      title: 'feat: x',
      html_url: 'https://github.com/o/r/pull/7',
      head: { ref: 'feat/1-x', repo: { full_name: 'o/r' } },
      base: { ref: 'release/next' },
    });
    writeFileSync(
      path.join(dir, 'gh'),
      `#!/bin/sh\ncase "$*" in\n  *nameWithOwner*) echo o/r ;;\n  *repos/o/r/pulls/7*) echo '${record}' ;;\n  *) exit 1 ;;\nesac\n`,
      { mode: 0o755 },
    );
    process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
  });
  afterAll(() => {
    process.env.PATH = oldPath;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads the pull request with the name of its base branch', async () => {
    const { create } = await import('../../../skills/delivery/deliver/scripts/tracker/github.mts');
    const tracker = create({ cwd: dir, base: '', selection: {}, trustAuthors: false });
    expect(tracker.pullRequest(7)).toEqual({
      pull: { id: 7, title: 'feat: x', url: 'https://github.com/o/r/pull/7', branch: 'feat/1-x' },
      base: 'release/next',
    });
  });
});
