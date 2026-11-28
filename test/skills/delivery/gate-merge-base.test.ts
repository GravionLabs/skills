// deliver: the gate script `merge-base` (#1159): the exported rule, the gate with a stub tracker, and the CLI with
// the real GitHub tracker and a fake `gh`.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  issueType,
  mergeBase,
  mergeBaseGate,
} from '../../../skills/delivery/deliver/scripts/gates/merge-base.mts';
import { runGate } from '../../../skills/delivery/deliver/scripts/gates/result.mts';
import type { Tracker } from '../../../skills/delivery/deliver/scripts/tracker.mts';
import { createFakeGh } from '../../helpers/fake-gh';

const script = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/gates/merge-base.mts',
);
const issue = { number: 7, title: '[Bug] fix(deliver): Crash on an empty Über-list (again)' };
const hotfix = {
  base: 'main',
  branch: 'fix/7-crash-on-an-empty-uber-list-again',
  backmerge: 'main→release/next',
};

describe('mergeBase', () => {
  it.each([
    ['a PBI', 'PBI', ['pbi']],
    ['a Bug without a parent', 'Bug', ['bug']],
    ['a PBI labeled hotfix', 'PBI', ['pbi', 'hotfix']],
  ])('targets release/next for %s', (_name, type, labels) => {
    expect(mergeBase({ issue, type, labels })).toMatchObject({
      result: 'pass',
      evidence: { issue: 7, base: 'release/next' },
    });
  });

  it('names the hotfix path of a Bug labeled hotfix, also with deliver.base', () => {
    const config = { deliver: { base: 'develop' } };
    expect(mergeBase({ issue, type: 'Bug', labels: ['bug', 'Hotfix'], config })).toEqual({
      result: 'pass',
      reason: 'merge into main',
      evidence: { issue: 7, ...hotfix },
    });
  });

  it.each([
    [`[Bug] fix: ${'a'.repeat(39)} tail`, `fix/7-${'a'.repeat(39)}`],
    ['[Bug] fix: !!!', 'fix/7-hotfix'],
  ])('cuts the slug of %j', (title, branch) => {
    const result = mergeBase({ issue: { number: 7, title }, type: 'bug', labels: ['hotfix'] });
    expect(result.evidence.branch).toBe(branch);
  });

  it.each([
    ['the flag, also for a hotfix', { flag: 'next', labels: ['hotfix'] }, 'next'],
    ['deliver.base', { labels: [] }, 'develop'],
  ])('takes %s', (_name, input, base) => {
    const result = mergeBase({
      issue,
      type: 'bug',
      config: { deliver: { base: 'develop' } },
      ...input,
    });
    expect(result.evidence).toEqual({ issue: 7, base });
  });

  it.each(['Feature', 'Epic', undefined])('is a usage error for the level %s', (type) => {
    expect(mergeBase({ issue, type })).toMatchObject({ result: 'usage' });
  });
});

describe('issueType', () => {
  it.each([
    [['PBI'], 'no prefix', 'pbi'],
    [['bug', 'feature'], '[Bug] x', 'feature'],
    [[], '[Bug] x', 'bug'],
    [[], 'x', undefined],
  ])('reads %j %j', (labels, title, type) => {
    expect(issueType(labels, title)).toBe(type);
  });
});

describe('mergeBaseGate', () => {
  it.each([
    ['a missing issue', () => undefined, 'not found'],
    [
      'a tracker error',
      () => {
        throw Object.assign(new Error('Command failed'), { stderr: 'HTTP 500\nmore' });
      },
      'not read: HTTP 500',
    ],
  ])('fails on %s', (_name, read, reason) => {
    const result = mergeBaseGate({ repo: 'o/r', issue: read } as unknown as Tracker, 7);
    expect(result).toMatchObject({ result: 'fail', evidence: { issue: 7 } });
    expect(result.reason).toContain(reason);
  });
});

describe('merge-base.mts', () => {
  let dir: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gate-merge-base-'));
    const gh = createFakeGh(
      dir,
      `(call) => {
        if (call.args[1] !== 'repos/o/r/issues/7') throw new Error('gh: Not Found (HTTP 404)');
        return { rest: {
          number: 7, title: ${JSON.stringify(issue.title)}, html_url: 'u', body: '', state: 'open',
          repository_url: 'https://api.github.com/repos/o/r',
          labels: [{ name: 'bug' }, { name: 'hotfix' }], author_association: 'OWNER',
        } };
      }`,
    );
    env = gh.env();
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('reads the issue through the tracker', async () => {
    await expect(runGate(script, ['7', '--repo', 'o/r'], { cwd: dir, env })).resolves.toMatchObject(
      { result: 'pass', evidence: hotfix },
    );
  });

  it.each([[[]], [['x']], [['7', '8']], [['7', '--nope']], [['7', '--tracker', '../x']]])(
    'is a usage error for %j',
    async (args) => {
      await expect(runGate(script, args, { cwd: dir, env })).resolves.toMatchObject({
        result: 'usage',
      });
    },
  );
});
