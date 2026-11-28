import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  parseRequires,
  readObjective,
  requirementState,
} from '../../../skills/delivery/deliver/scripts/objective.mts';
import { create as createGithub } from '../../../skills/delivery/deliver/scripts/tracker/github.mts';
import type {
  Item,
  Tracker,
  TrackerContext,
} from '../../../skills/delivery/deliver/scripts/tracker.mts';
import { createFakeGh } from '../../helpers/fake-gh';
import { create, type Scenario } from './deliver/tracker/fake.mts';

const context: TrackerContext = { cwd: '.', base: 'main', selection: {}, trustAuthors: false };
const done = (closedAt: string, milestone: string) =>
  ({ state: 'closed', stateReason: 'completed', closedAt, milestone }) as const;

const repositories: NonNullable<Scenario['repositories']> = {
  'o/a': {
    issues: [
      {
        number: 1,
        title: '[Objective] x',
        body: [
          '## Affected repos',
          '- o/a',
          '- o/c',
          '## Requires',
          'Requires: o/b@M002 rc',
          'Requires: ../b#3',
          'Requires: o/b#10',
          '<!-- Requires: o/b#99 -->',
        ].join('\n'),
        subIssues: [2, 'o/b#3', 'other/z#1'],
      },
      {
        number: 2,
        title: '[Feature] a',
        body: 'Requires: o/b#10',
        milestone: 'M005',
        subIssues: [4, 5, 6],
      },
      { number: 4, title: '[PBI] open', labels: ['pbi'] },
      { number: 5, title: '[Bug] open' },
      { number: 6, title: '[PBI] closed', ...done('2026-01-01', 'M001 (1.0.0)') },
    ],
  },
  'o/b': {
    issues: [
      { number: 3, title: '[Epic] e', subIssues: [7] },
      { number: 7, title: '[Feature] later', labels: ['feature', 'deferred'], subIssues: [8] },
      { number: 8, title: '[PBI] not now' },
      // released: the release of its last PBI is tagged
      { number: 10, title: '[Feature] out', state: 'closed', subIssues: [11, 12, 13] },
      { number: 11, title: '[PBI] first', ...done('2026-01-01', 'M001') },
      { number: 12, title: '[PBI] last', ...done('2026-02-01', 'M002 (1.1.0)') },
      { number: 13, title: '[PBI] dropped', state: 'closed', stateReason: 'not_planned' },
      // the last PBI is merged, its release has no tag yet
      { number: 20, title: '[Feature] merged', state: 'closed', subIssues: [21, 22] },
      { number: 21, title: '[PBI] first', ...done('2026-01-01', 'M002 (1.1.0)') },
      { number: 22, title: '[PBI] last', ...done('2026-03-01', 'M003 (1.2.0)') },
      { number: 30, title: '[Feature] open', subIssues: [31] },
      { number: 31, title: '[PBI] shipped', ...done('2026-01-01', 'M002 (1.1.0)') },
      { number: 40, title: '[Bug] no feature', state: 'closed' },
    ],
    milestones: [
      { title: 'M002 (1.1.0)', closed: true },
      { title: 'M003', closed: false },
    ],
    tags: ['v1.1.0'],
  },
};

let dir: string;
let tracker: Tracker;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'deliver-objective-'));
  const scenario: Scenario = {
    repositories,
    items: [
      { id: 1, title: 'released upstream', blockedBy: ['o/b#11'] },
      { id: 2, title: 'open upstream Feature', blockedBy: ['o/b#31'] },
      { id: 3, title: 'closed blocker without a Feature', blockedBy: ['o/b#40'] },
    ],
  };
  writeFileSync(path.join(dir, 'scenario.json'), JSON.stringify(scenario));
  vi.stubEnv('FAKE_DIR', dir);
  tracker = create(context);
});
afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe('parseRequires', () => {
  it('reads both forms', () => {
    expect(parseRequires('Requires: o/b@M004 released\n- Requires: `o/b#7`')).toEqual([
      { repo: 'o/b', milestone: 'M004', mode: 'released' },
      { repo: 'o/b', feature: 7 },
    ]);
  });

  it.each(['../b#3', 'o/..#3', 'o/b/c#3', 'b#3', 'o/b@M004', 'o/b#0'])(
    'drops the line %s and keeps the others',
    (line) => {
      expect(parseRequires(`Requires: ${line}\nRequires: o/b#1`)).toEqual([
        { repo: 'o/b', feature: 1 },
      ]);
    },
  );
});

describe('readObjective', () => {
  it('reads an Objective over two repositories with an Epic child and a deferred Feature', () => {
    const read = readObjective('o/a#1', tracker);
    expect(read.repositories).toEqual(['o/a', 'o/b', 'o/c']);
    expect(read.requires).toEqual([
      { repo: 'o/b', milestone: 'M002', mode: 'rc' },
      { repo: 'o/b', feature: 10 },
    ]);
    expect(read.epics.map((e) => e.number)).toEqual([3]);
    expect(
      read.features.map((f) => ({
        ref: `${f.repo}#${f.number}`,
        epic: f.epic?.number,
        milestone: f.milestone,
        deferred: f.deferred,
        requires: f.requires.length,
        work: f.work.map((w) => w.number),
      })),
    ).toEqual([
      { ref: 'o/a#2', milestone: 'M005', deferred: false, requires: 1, work: [4, 5] },
      { ref: 'o/b#7', epic: 3, deferred: true, requires: 0, work: [] },
    ]);
  });

  it('fails for an Objective that does not exist', () => {
    expect(() => readObjective('o/a#999', tracker)).toThrow('not found');
  });
});

describe('requirementState', () => {
  it.each(['o/b@M002 released', 'o/b@M2 rc', 'o/b#10'])('is met for %s', (line) => {
    const [req] = parseRequires(`Requires: ${line}`);
    expect(requirementState(req!, tracker)).toEqual({ state: 'met' });
  });

  it.each([
    ['o/b@M003 rc', 'o/b@M003'],
    ['o/b@M009 released', 'o/b@M009'],
    ['o/b#20', 'o/b#20'],
    ['o/b#30', 'o/b#30'],
    ['o/b#999', 'o/b#999'],
  ])('waits for %s', (line, target) => {
    const [req] = parseRequires(`Requires: ${line}`);
    expect(requirementState(req!, tracker)).toEqual({
      state: 'waiting',
      reason: `upstream ${target} not released`,
    });
  });
});

describe('blockers in another repository', () => {
  it.each([
    [1, undefined],
    [2, 'upstream o/b#30 not released'],
    [3, undefined],
  ])('item %i waits for the release of the blocker’s Feature', (id, reason) => {
    expect(tracker.waitReason({ id } as Item)).toBe(reason);
  });
});

// the fake gh is a POSIX shell wrapper
describe.skipIf(process.platform === 'win32')('the GitHub tracker', () => {
  it('waits for a closed blocker of another repository until its Feature is released', () => {
    const fake = createFakeGh(
      dir,
      `(call) => {
        if (call.args[0] === 'repo') return { rest: 'o/a' };
        const issue = (repo, number, title, more = {}) => ({ number, title, state: 'closed', body: '',
          labels: [], html_url: 'u', repository_url: 'https://api.github.com/repos/' + repo, ...more });
        const pbi = issue('o/b', 12, '[PBI] last', { state_reason: 'completed',
          closed_at: '2026-02-01', milestone: { title: 'M002 (1.1.0)' } });
        const route = call.args[1].split('?')[0];
        const data = {
          'repos/o/a/issues/4/dependencies/blocked_by': [pbi],
          'repos/o/b/issues/12': pbi,
          'repos/o/b/issues/12/parent': issue('o/b', 10, '[Feature] out'),
          'repos/o/b/issues/10': issue('o/b', 10, '[Feature] out'),
          'repos/o/b/issues/10/sub_issues': [pbi],
        };
        if (route in data) return { rest: call.args.includes('--slurp') ? [data[route]] : data[route] };
        throw new Error('gh: Not Found (HTTP 404)');
      }`,
    );
    vi.stubEnv('PATH', fake.env().PATH as string);
    const github = createGithub({ ...context, trustAuthors: true });
    expect(github.waitReason({ id: 4, labels: [] } as unknown as Item)).toBe(
      'upstream o/b#10 not released',
    );
    expect(fake.calls().at(-1)?.args[1]).toBe('repos/o/b/git/ref/tags/1.1.0');
  });
});
