// Gate `guard` (#1156): the merge guard as a pure check and as a CLI over the fake tracker.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  type Compare,
  GUARD_READS,
  guardCheck,
  readChangedFiles,
} from '../../../skills/delivery/deliver/scripts/gates/guard.mts';
import { runGate } from '../../../skills/delivery/deliver/scripts/gates/result.mts';
import { protectedList } from '../../../skills/delivery/deliver/scripts/protected-paths.mts';

const skill = path.resolve(__dirname, '../../../skills/delivery/deliver');
const script = path.join(skill, 'scripts/gates/guard.mts');
const LIST = protectedList(undefined);

/** Two sides of the named manifests: `base-sha` is the merge base, everything else the head. */
const sides = (files: Record<string, { base?: string; head?: string }>): Compare => ({
  refs: () => ({ base: 'base-sha', head: 'head-sha' }),
  fileAt: (sha, file) => (sha === 'base-sha' ? files[file]?.base : files[file]?.head),
});
const pkg = (extra: object) => JSON.stringify({ name: 'x', dependencies: { a: '1' }, ...extra });
const cargo = ['[package]', 'name = "x"', '', '[dependencies]', 'serde = "1"', ''].join('\n');

describe('guardCheck', () => {
  it('passes files outside the protected paths', () => {
    expect(guardCheck({ files: ['src/a.ts'], protectedList: LIST })).toMatchObject({
      result: 'pass',
    });
  });

  it('hands a protected path to the owner with the reason of the loop', () => {
    const files = ['src/a.ts', '.github/workflows/ci.yml', 'packages/x/package.json'];
    expect(guardCheck({ files, protectedList: LIST })).toEqual({
      result: 'owner',
      reason:
        'changes protected paths (.github/workflows/ci.yml, packages/x/package.json), merge it yourself',
      evidence: { hits: ['.github/workflows/ci.yml', 'packages/x/package.json'] },
    });
  });

  it('names at most three hits', () => {
    const files = ['.claude/a', '.claude/b', '.claude/c', '.claude/d'];
    expect(guardCheck({ files, protectedList: LIST }).reason).toBe(
      'changes protected paths (.claude/a, .claude/b, .claude/c, …), merge it yourself',
    );
  });

  it('passes a package.json that changes only its dependencies', () => {
    const compare = sides({
      'package.json': { base: pkg({}), head: pkg({ dependencies: { a: '2' } }) },
    });
    expect(guardCheck({ files: ['package.json'], compare, protectedList: LIST }).result).toBe(
      'pass',
    );
  });

  it.each([
    [
      'package.json: scripts',
      'package.json',
      { base: pkg({}), head: pkg({ scripts: { x: 'y' } }) },
    ],
    [
      'Cargo.toml: patch',
      'Cargo.toml',
      { base: cargo, head: `${cargo}\n[patch.crates-io]\nserde = { path = "x" }\n` },
    ],
    ['package.json', 'package.json', { base: undefined, head: pkg({}) }],
    ['package.json', 'package.json', { base: pkg({}), head: '{' }],
  ])('keeps the reason %s of a manifest', (reason, file, contents) => {
    const compare = sides({ [file]: contents });
    expect(guardCheck({ files: [file], compare, protectedList: LIST }).reason).toBe(
      `changes protected paths (${reason}), merge it yourself`,
    );
  });

  it('treats a manifest as a plain hit when the merge base is unknown', () => {
    const compare: Compare = {
      refs: () => {
        throw new Error('no merge base');
      },
      fileAt: () => undefined,
    };
    expect(guardCheck({ files: ['Cargo.toml'], compare, protectedList: LIST }).reason).toBe(
      'changes protected paths (Cargo.toml), merge it yourself',
    );
  });

  it('hands a pull request above mergeRisk to the owner; a missing level is medium', () => {
    expect(guardCheck({ risk: 'high', mergeRisk: 'medium' })).toEqual({
      result: 'owner',
      reason: 'risk high, merge it yourself',
      evidence: { risk: 'high', mergeRisk: 'medium' },
    });
    expect(guardCheck({ mergeRisk: 'low' }).reason).toBe('risk medium, merge it yourself');
    expect(guardCheck({ mergeRisk: 'medium' }).result).toBe('pass');
    expect(guardCheck({ risk: 'high', mergeRisk: 'high' }).result).toBe('pass');
  });

  it('checks the paths before the risk', () => {
    expect(
      guardCheck({ files: ['.claude/x'], protectedList: LIST, risk: 'high', mergeRisk: 'low' })
        .reason,
    ).toBe('changes protected paths (.claude/x), merge it yourself');
  });

  it('hands changed files that cannot be read to the owner', () => {
    expect(guardCheck({ files: { error: 'HTTP 500' }, protectedList: LIST })).toEqual({
      result: 'owner',
      reason: 'could not read the changed files (HTTP 500), merge it yourself',
      evidence: { error: 'HTTP 500' },
    });
  });
});

describe('readChangedFiles', () => {
  const failing = (failures: number) => {
    let reads = 0;
    return {
      read: () => {
        reads++;
        if (reads <= failures) throw new Error(`HTTP 500\nbody ${reads}`);
        return ['src/a.ts'];
      },
      reads: () => reads,
    };
  };
  const pause = async () => {};

  it('asks again after a failed read', async () => {
    const source = failing(GUARD_READS - 1);
    await expect(readChangedFiles(source.read, { pause })).resolves.toEqual(['src/a.ts']);
    expect(source.reads()).toBe(GUARD_READS);
  });

  it(`gives up after ${GUARD_READS} reads with the first line of the last error`, async () => {
    const source = failing(GUARD_READS);
    await expect(readChangedFiles(source.read, { pause })).resolves.toEqual({
      error: `HTTP 500`,
    });
    expect(source.reads()).toBe(GUARD_READS);
  });

  it('asks no more once stopped', async () => {
    const source = failing(GUARD_READS);
    await readChangedFiles(source.read, { pause, stopped: () => true });
    expect(source.reads()).toBe(1);
  });
});

describe('guard CLI', () => {
  let repo: string;
  let fake: string;
  const tracker = path.resolve(__dirname, 'deliver/tracker');

  beforeAll(() => {
    const dir = mkdtempSync(path.join(tmpdir(), 'gate-guard-'));
    repo = path.join(dir, 'repo');
    fake = path.join(dir, 'fake');
    mkdirSync(path.join(repo, '.agents'), { recursive: true });
    mkdirSync(fake);
    execFileSync('git', ['init', '-q', repo]);
  });
  afterAll(() => rmSync(path.dirname(repo), { recursive: true, force: true }));

  /** `deliver` is the config at the merge base; `head` the one the pull request and the checkout bring. */
  const run = (
    args: string[],
    {
      scenario = {},
      deliver = {},
      head,
    }: { scenario?: object; deliver?: object; head?: object } = {},
  ) => {
    const config = (value: object | undefined) =>
      value === undefined ? undefined : JSON.stringify({ deliver: value });
    writeFileSync(path.join(repo, '.agents/config.json'), config(head) ?? '{}');
    writeFileSync(
      path.join(fake, 'scenario.json'),
      JSON.stringify({
        items: [],
        projectConfig: { base: config(deliver), head: config(head) },
        ...scenario,
      }),
    );
    return runGate(script, ['--tracker', 'fake', ...args], {
      cwd: repo,
      env: { ...process.env, DELIVER_TRACKER_DIR: tracker, FAKE_DIR: fake, DELIVER_TICK_MS: '1' },
    });
  };

  it('passes a pull request without a protected path, with the judged head in the evidence', async () => {
    await expect(run(['7'])).resolves.toMatchObject({
      result: 'pass',
      evidence: { pr: 7, head: 'abc123', base: 'base-sha' },
    });
  });

  it('hands a protected path to the owner', async () => {
    const out = await run(['7'], { scenario: { files: ['src/a.ts', '.github/workflows/x.yml'] } });
    expect(out).toMatchObject({
      result: 'owner',
      reason: 'changes protected paths (.github/workflows/x.yml), merge it yourself',
      evidence: { head: 'abc123' },
    });
  });

  it('judges a manifest at the head of the pull request', async () => {
    const scenario = {
      files: ['package.json'],
      packageJson: { base: pkg({}), head: pkg({ scripts: { x: 'y' } }) },
    };
    await expect(run(['7', '--head', 'abc123'], { scenario })).resolves.toMatchObject({
      result: 'owner',
      reason: 'changes protected paths (package.json: scripts), merge it yourself',
    });
  });

  it('does not pass a --head the pull request is not at', async () => {
    await expect(run(['7', '--head', 'def456'])).resolves.toMatchObject({
      result: 'owner',
      reason: 'head mismatch: asked for def456, the pull request is at abc123, merge it yourself',
      evidence: { head: 'abc123', askedHead: 'def456' },
    });
  });

  it('does not pass when the pull request is pushed while its files are read', async () => {
    await expect(run(['7'], { scenario: { pushedAtCompare: 2 } })).resolves.toMatchObject({
      result: 'owner',
      reason: expect.stringMatching(/^pushed while guarded: judged abc123/),
      evidence: { head: 'abc123', prHead: 'def456' },
    });
  });

  it('reads deliver.protectedPaths and deliver.mergeRisk of the config at the merge base', async () => {
    await expect(
      run(['7', '--risk', 'high'], { deliver: { protectedPaths: ['src/'], mergeRisk: 'high' } }),
    ).resolves.toMatchObject({
      result: 'owner',
      reason: 'changes protected paths (src/a.ts), merge it yourself',
    });
    await expect(
      run(['7', '--risk', 'high'], { deliver: { mergeRisk: 'high' } }),
    ).resolves.toMatchObject({ result: 'pass' });
  });

  it('ignores a config the pull request and the checkout bring', async () => {
    const out = await run(['7', '--risk', 'high'], {
      scenario: { files: ['.github/workflows/x.yml'] },
      head: { protectedPaths: [], mergeRisk: 'high', tracker: 'other' },
    });
    expect(out).toMatchObject({
      result: 'owner',
      reason: 'changes protected paths (.github/workflows/x.yml), merge it yourself',
    });
  });

  it.each([
    ['a failing read', 'throw'],
    ['no JSON', { base: '{' }],
    ['no object', { base: '[]' }],
  ])('does not pass when the config at the merge base is %s', async (_name, projectConfig) => {
    await expect(run(['7'], { scenario: { projectConfig } })).resolves.toMatchObject({
      result: 'owner',
      reason: expect.stringMatching(/^could not read \.agents\/config\.json at the base base-sha/),
    });
  });

  it('holds a protected list the matcher cannot read', async () => {
    await expect(run(['7'], { deliver: { protectedPaths: [7] } })).resolves.toMatchObject({
      result: 'owner',
      reason: expect.stringMatching(/^could not read the changed files \(.+\), merge it yourself$/),
    });
  });

  it('hands a risk above --merge-risk to the owner, from --risk or --result-file', async () => {
    await expect(run(['7', '--risk', 'high'])).resolves.toMatchObject({
      result: 'owner',
      reason: 'risk high, merge it yourself',
    });
    const file = path.join(fake, 'result.json');
    writeFileSync(file, JSON.stringify({ risk: { level: 'medium' } }));
    await expect(run(['7', '--result-file', file, '--merge-risk', 'low'])).resolves.toMatchObject({
      result: 'owner',
      reason: 'risk medium, merge it yourself',
    });
  });

  it('hands changed files that cannot be read to the owner', async () => {
    await expect(run(['7'], { scenario: { filesFailures: GUARD_READS } })).resolves.toMatchObject({
      result: 'owner',
      reason: 'could not read the changed files (HTTP 500), merge it yourself',
    });
  });

  it.each([
    ['no pull request', []],
    ['a pull request that is no number', ['abc']],
    ['an unknown flag', ['7', '--nope']],
    ['a risk that is no level', ['7', '--risk', 'huge']],
    ['a merge risk that is no level', ['7', '--merge-risk', 'huge']],
    ['both risk sources', ['7', '--risk', 'low', '--result-file', 'x.json']],
  ])('reports %s as usage', async (_name, args) => {
    await expect(run(args)).resolves.toMatchObject({ result: 'usage' });
  });

  it('reports a base config that names another tracker as usage', async () => {
    await expect(run(['7'], { deliver: { tracker: 'github' } })).resolves.toMatchObject({
      result: 'usage',
      reason: expect.stringContaining('--tracker github'),
    });
  });

  it('refuses a tracker directory inside the repository', async () => {
    const out = await runGate(script, ['7', '--tracker', 'fake'], {
      cwd: repo,
      env: { ...process.env, DELIVER_TRACKER_DIR: path.join(repo, '.agents'), FAKE_DIR: fake },
    });
    expect(out).toMatchObject({
      result: 'usage',
      reason: 'DELIVER_TRACKER_DIR must not be inside the repository',
    });
  });

  it('reports a tracker that does not load as fail', async () => {
    await expect(run(['7', '--tracker', 'missing'])).resolves.toMatchObject({
      result: 'fail',
      reason: expect.stringMatching(/^tracker: /),
    });
  });
});
