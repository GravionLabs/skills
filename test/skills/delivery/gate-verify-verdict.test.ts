import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGate } from '../../../skills/delivery/deliver/scripts/gates/result.mts';
import { verifyVerdict } from '../../../skills/delivery/deliver/scripts/gates/verify-verdict.mts';

const gate = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/gates/verify-verdict.mts',
);
const fake = path.resolve(__dirname, 'deliver/tracker/fake.mts');

const finding = { severity: 'blocking', file: 'a.ts', summary: 'x' };
const approve = JSON.stringify({ verdict: 'approve', findings: [], unmet: [] });
const changes = JSON.stringify({ verdict: 'changes', findings: [finding], unmet: ['c'] });

describe('verifyVerdict', () => {
  const check = (content: string | undefined, prHead = 'aaa') =>
    verifyVerdict({ content, reviewedHead: 'aaa', prHead });

  it('passes a valid approve of the head of the pull request', () => {
    expect(check(approve)).toEqual({
      result: 'pass',
      reason: 'approved',
      evidence: { head: 'aaa' },
      verdict: JSON.parse(approve),
    });
  });

  it('fails changes and keeps the findings and unmet criteria', () => {
    expect(check(changes)).toMatchObject({
      result: 'fail',
      evidence: { findings: [finding], unmet: ['c'] },
      verdict: JSON.parse(changes),
    });
  });

  it.each([
    ['a missing file', undefined, 'no verdict'],
    ['an invalid file', 'approve', 'invalid verdict'],
  ])('fails %s', (_name, content, reason) => {
    expect(check(content)).toEqual({ result: 'fail', reason, evidence: {} });
  });

  it.each([
    ['approve', approve],
    ['changes', changes],
  ])('fails %s of another head and names both commits', (_name, content) => {
    const result = check(content, 'bbb');
    expect(result).toEqual({
      result: 'fail',
      reason: 'head mismatch: reviewed aaa, the pull request is at bbb',
      evidence: { reviewedHead: 'aaa', prHead: 'bbb' },
    });
  });
});

describe('verify-verdict', () => {
  let dir: string;
  let repo: string;
  let head: string;
  let env: NodeJS.ProcessEnv;

  // the fake tracker has every pull request at the commit `abc123`
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gate-verdict-'));
    repo = path.join(dir, 'repo');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
    execFileSync('git', ['init', '--quiet', repo]);
    git(
      '-c',
      'user.name=t',
      '-c',
      'user.email=t@example.test',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--quiet',
      '--allow-empty',
      '-m',
      'init',
    );
    head = git('rev-parse', 'HEAD');
    writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify({ items: [] }));
    writeFileSync(path.join(dir, 'approve.json'), approve);
    const trackers = path.join(dir, 'trackers');
    mkdirSync(trackers);
    writeFileSync(
      path.join(trackers, 'github.mts'),
      `export { create } from ${JSON.stringify(pathToFileURL(fake).href)};\n`,
    );
    env = { ...process.env, FAKE_DIR: dir, DELIVER_TRACKER_DIR: trackers };
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (args: string[], extra: NodeJS.ProcessEnv = {}) =>
    runGate(gate, args, { cwd: repo, env: { ...env, ...extra } });
  const file = (name: string) => path.join(dir, name);

  it('passes with the reviewed commit of --head', async () => {
    await expect(run([file('approve.json'), '7', '--head', 'abc123'])).resolves.toEqual({
      result: 'pass',
      reason: 'approved',
      evidence: { head: 'abc123' },
    });
  });

  it('takes the commit of the checkout without --head', async () => {
    await expect(run([file('approve.json'), '7'])).resolves.toMatchObject({
      result: 'fail',
      evidence: { reviewedHead: head, prHead: 'abc123' },
    });
  });

  it('fails a missing file', async () => {
    await expect(run([file('none.json'), '7', '--head', 'abc123'])).resolves.toMatchObject({
      result: 'fail',
      reason: 'no verdict',
    });
  });

  it.each([
    ['no pull request', ['v.json']],
    ['a pull request that is no number', ['v.json', 'x']],
    ['an unknown option', ['v.json', '7', '--nope']],
    ['an empty --head', ['v.json', '7', '--head=']],
  ])('reports usage on %s', async (_name, args) => {
    await expect(run(args)).resolves.toMatchObject({ result: 'usage' });
  });

  it('refuses a tracker directory inside the repository', async () => {
    await expect(
      run([file('approve.json'), '7'], { DELIVER_TRACKER_DIR: repo }),
    ).resolves.toMatchObject({
      result: 'usage',
      reason: expect.stringContaining('inside the repository'),
    });
  });
});
