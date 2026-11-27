import { describe, it, expect, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const script = path.resolve(__dirname, '../../../skills/delivery/retro/scripts/run-metrics.mts');
const root = path.resolve(__dirname, 'retro-fixtures');
const first = '20261101T100000-100';
const second = '20261102T100000-200';

const run = (...args: string[]) =>
  spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
const read = (...args: string[]) => {
  const result = run(...args);
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout);
};

describe('run-metrics.mts', () => {
  let one: ReturnType<typeof read>;
  let both: ReturnType<typeof read>;
  beforeAll(() => {
    one = read('--run', path.join(root, first));
    both = read('--root', root, '--issues', '11,#12,13,14,15,99');
  });
  const issue = (data: ReturnType<typeof read>, nr: number) =>
    data.issues.find((i: { issue: number }) => i.issue === nr);

  it('measures a merged issue per role', () => {
    expect(issue(one, 11)).toMatchObject({
      outcome: 'merged',
      risk: 'low',
      minutes: 10,
      costUsd: 1,
      roles: {
        implement: { sessions: 1, costUsd: 0.75, peakContext: 98527 },
        review: { sessions: 1, costUsd: 0.25, peakContext: 46189 },
      },
      reviewRounds: 1,
      fixRounds: 0,
    });
    expect(one.runs).toEqual([{ run: first, path: path.join(root, first), status: 'blocked' }]);
  });

  it('counts the rounds with changes as fix rounds and takes the highest peak of a role', () => {
    expect(issue(one, 13)).toMatchObject({
      reviewRounds: 2,
      fixRounds: 1,
      costUsd: 1.875,
      roles: { implement: { sessions: 2, costUsd: 1.5, peakContext: 126125 } },
    });
  });

  it('lists an issue set aside as an escalation with its reason', () => {
    expect(one.escalations).toEqual([
      {
        issue: 12,
        outcome: 'aside',
        reason: 'session ended without a pull request',
        pr: null,
        run: first,
      },
    ]);
    expect(issue(one, 12).roles.review).toEqual({
      sessions: 0,
      costUsd: null,
      peakContext: null,
    });
  });

  it('keeps the sessions of a handed-over issue that a person merged later', () => {
    expect(issue(one, 14)).toMatchObject({
      outcome: 'merged',
      reason: null,
      risk: 'low',
      minutes: 7,
      costUsd: 0.5,
      reviewRounds: 0,
    });
  });

  it('merges two runs by issue: the last result wins', () => {
    expect(both.runs.map((r: { run: string }) => r.run)).toEqual([first, second]);
    expect(both.issues.map((i: { issue: number }) => i.issue)).toEqual([11, 12, 13, 14, 15]);
    expect(issue(both, 12)).toMatchObject({
      run: second,
      earlierRuns: [first],
      outcome: 'merged',
      reviewRounds: 2,
      fixRounds: 1,
    });
    expect(both.escalations.map((e: { issue: number }) => e.issue)).toEqual([15]);
    expect(both.uncovered).toEqual([99]);
  });

  it('reports a figure a session lacks as not measured', () => {
    expect(issue(both, 12)).toMatchObject({
      costUsd: null,
      roles: { implement: { costUsd: 0.5 }, review: { costUsd: null, peakContext: null } },
    });
  });

  it('reads the findings of the verdict files and names the repeated ones', () => {
    expect(both.findings).toMatchObject([
      { issue: 13, run: first, round: 1, file: 'src/dialog.ts', summary: 'input has no test' },
      { issue: 12, run: second, round: 1, file: 'src/dialog.ts', summary: 'input has no test' },
    ]);
    expect(both.repeated).toMatchObject([{ file: 'src/dialog.ts', issues: [13, 12] }]);
    expect(one.repeated).toEqual([]);
  });

  it('takes the newest run folder without arguments, and only the runs of the issues', () => {
    expect(read('--root', root).runs.map((r: { run: string }) => r.run)).toEqual([second]);
    expect(read('--root', root, '--issues', '11').runs).toHaveLength(1);
  });

  it.each([
    ['--run', path.join(root, 'none')],
    ['--root', path.join(root, 'none')],
  ])('says that there is no run folder (%s)', (flag, folder) => {
    expect(read(flag, folder)).toMatchObject({ runs: [], issues: [], missing: [folder] });
  });

  it.each([['--issues', 'x'], ['--nope']])('refuses %s %s', (...args) => {
    const result = run(...args);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/^run-metrics: /);
  });
});
