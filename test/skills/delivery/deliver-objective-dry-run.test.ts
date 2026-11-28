// `deliver-loop --objective <owner>/<repo>#<nr>`: the plan of a two-repository Objective, and the exits of the flag.
import { describe, expect, it } from 'vitest';
import { fixture, loop, type Scenario } from './deliver/run-loop';

const scenario: Scenario = {
  items: [],
  repositories: {
    'x/app': {
      issues: [
        {
          number: 1,
          title: '[Objective] o',
          labels: ['objective'],
          body: [
            '## Affected repos',
            '- x/app',
            '- x/lib',
            '## Requires',
            'Requires: x/lib@M001 released',
          ].join('\n'),
          subIssues: [2, 'x/lib#3', 'x/lib#8', 9],
        },
        {
          number: 2,
          title: '[Feature] app',
          milestone: 'M002',
          body: 'Requires: x/lib#10',
          subIssues: [4, 5, 6],
        },
        { number: 4, title: '[PBI] ready', labels: ['pbi'] },
        { number: 5, title: '[PBI] held', labels: ['pbi', 'needs-decision'] },
        { number: 6, title: '[PBI] blocked', labels: ['pbi'], blockedBy: ['x/lib#11'] },
        { number: 9, title: '[Feature] later', labels: ['feature', 'deferred'] },
      ],
    },
    'x/lib': {
      issues: [
        { number: 3, title: '[Feature] lib', milestone: 'M001', subIssues: [7] },
        { number: 7, title: '[PBI] lib work', labels: ['pbi'] },
        { number: 8, title: '[Feature] empty' },
        { number: 11, title: '[PBI] open upstream', labels: ['pbi'] },
      ],
      milestones: [{ title: 'M001', closed: false }],
    },
  },
};

// the app settings of the user must not decide what the test sees
const noApp = { DELIVER_APP_ID: '', DELIVER_APP_KEY_FILE: '', DELIVER_APP_KEY_COMMAND: '' };

describe('deliver-loop --objective', () => {
  fixture();

  it('prints the repositories in start order, each Feature and the wait reason of each item, and starts nothing', async () => {
    const out = await loop(scenario, {
      args: ['--objective', 'x/app#1', '--dry-run'],
      env: noApp,
    });
    expect(out.status).toBe(0);
    expect(out.stdout.trim().split('\n')).toEqual([
      'Objective x/app#1 starts in: x/lib, x/app',
      '  requires: upstream x/lib@M001 not released',
      'x/lib',
      '  session token: none, the session uses your login',
      '  feature x/lib#3 M001',
      '    x/lib#7 upstream x/lib@M001 not released',
      '  feature x/lib#8',
      '    gap: no open PBI or Bug',
      'x/app',
      '  session token: none, the session uses your login',
      '  feature x/app#2 M002',
      '    x/app#4 upstream x/lib@M001 not released, upstream x/lib#10 not released',
      '    x/app#5 needs-decision, upstream x/lib@M001 not released, upstream x/lib#10 not released',
      '    x/app#6 upstream x/lib@M001 not released, upstream x/lib#10 not released, blocked by x/lib#11',
      '  feature x/app#9 deferred',
    ]);
    expect(out.sessions).toEqual([]);
    expect(out.merges).toEqual([]);
  });

  it.each([
    [
      'the GitHub App',
      { DELIVER_APP_ID: '4242', DELIVER_APP_KEY_FILE: 'unread.pem' },
      (repo: string) => `GitHub App, a token of ${repo}`,
    ],
    [
      'DELIVER_SESSION_TOKEN',
      { DELIVER_SESSION_TOKEN: 'secret-value' },
      () => 'DELIVER_SESSION_TOKEN',
    ],
  ])(
    'prints %s as the token source of each repository and mints nothing',
    async (_, env, source) => {
      const out = await loop(scenario, {
        args: ['--objective', 'x/app#1', '--dry-run'],
        env: { ...noApp, ...env },
      });
      expect(out.status, out.stderr).toBe(0);
      expect(out.stdout).toContain(`x/lib\n  session token: ${source('x/lib')}\n`);
      expect(out.stdout).toContain(`x/app\n  session token: ${source('x/app')}\n`);
      expect(out.stdout).not.toContain('secret-value');
    },
  );

  it('exits 64 for a malformed reference', async () => {
    const out = await loop(scenario, { args: ['--objective', 'x/app', '--dry-run'] });
    expect(out.status).toBe(64);
    expect(out.stderr).toContain('--objective is <owner>/<repo>#<nr>');
  });

  it('exits 64 with another selection', async () => {
    const out = await loop(scenario, {
      args: ['--objective', 'x/app#1', '--milestone', 'M001', '--dry-run'],
    });
    expect(out.status).toBe(64);
    expect(out.stderr).toContain('give exactly one of');
  });

  it('exits 1 for an Objective that does not exist', async () => {
    const out = await loop(scenario, { args: ['--objective', 'x/app#99', '--dry-run'] });
    expect(out.status).toBe(1);
    expect(out.stderr).toContain('objective: x/app#99 not found');
  });
});
