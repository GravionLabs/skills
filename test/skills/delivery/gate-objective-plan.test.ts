// The gate `objective-plan`: the plan of an Objective as JSON, and its result words.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { runGate } from '../../../skills/delivery/deliver/scripts/gates/result.mts';

const gate = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/gates/objective-plan.mts',
);
const fake = path.resolve(__dirname, 'deliver/tracker/fake.mts');

const scenario = {
  items: [],
  repositories: {
    'x/app': {
      issues: [
        {
          number: 1,
          title: '[Objective] o',
          labels: ['objective'],
          body: '## Affected repos\n- x/app\n- x/lib\n## Requires\nRequires: x/lib@M001 released',
          subIssues: [2, 'x/lib#3', 9],
        },
        { number: 2, title: '[Feature] app', milestone: 'M002', subIssues: [4] },
        { number: 4, title: '[PBI] held', labels: ['pbi', 'needs-decision'] },
        { number: 9, title: '[Feature] later', labels: ['feature', 'deferred'] },
      ],
    },
    'x/lib': {
      issues: [{ number: 3, title: '[Feature] empty' }],
      milestones: [{ title: 'M001', closed: false }],
    },
  },
};

describe('objective-plan', () => {
  let dir: string;
  let repo: string;
  let env: NodeJS.ProcessEnv;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'gate-plan-'));
    repo = path.join(dir, 'repo');
    execFileSync('git', ['init', '--quiet', repo]);
    writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(scenario));
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

  it('passes with the plan as evidence, a gap included', async () => {
    const upstream = 'upstream x/lib@M001 not released';
    await expect(run(['x/app#1', '--json'])).resolves.toEqual({
      result: 'pass',
      reason: 'plan of x/app#1: repositories 2, gaps 1',
      evidence: {
        objective: 'x/app#1',
        requires: { declared: 1, waiting: [upstream] },
        repositories: [
          {
            repo: 'x/app',
            features: [
              {
                repo: 'x/app',
                number: 2,
                deferred: false,
                milestone: 'M002',
                closed: false,
                leaves: [
                  {
                    repo: 'x/app',
                    number: 4,
                    ready: false,
                    reasons: ['needs-decision', upstream],
                  },
                ],
              },
              { repo: 'x/app', number: 9, deferred: true },
            ],
          },
          {
            repo: 'x/lib',
            features: [{ repo: 'x/lib', number: 3, deferred: false, closed: false, leaves: [] }],
          },
        ],
        gaps: ['x/lib#3'],
      },
    });
  });

  it.each([
    ['no reference', []],
    ['a reference without a number', ['x/app']],
    ['a second argument', ['x/app#1', 'x/app#2']],
    ['an unknown option', ['x/app#1', '--nope']],
  ])('reports usage on %s', async (_name, args) => {
    await expect(run(args)).resolves.toMatchObject({ result: 'usage' });
  });

  it('refuses a tracker directory inside the repository', async () => {
    await expect(run(['x/app#1'], { DELIVER_TRACKER_DIR: repo })).resolves.toMatchObject({
      result: 'usage',
      reason: expect.stringContaining('inside the repository'),
    });
  });

  it('fails when the Objective cannot be read', async () => {
    await expect(run(['x/app#99'])).resolves.toEqual({
      result: 'fail',
      reason: 'x/app#99 not found',
      evidence: {},
    });
  });
});
