// `deliver-loop --objective <owner>/<repo>#<nr>` without `--dry-run`: one frontier over the repositories of the
// Objective (objective-run.mts). Each repository is cloned from DELIVER_REPOS_DIR; the fake tracker works the
// milestone of a unit from `repositories`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Scenario,
  type Span,
  fixture,
  git,
  lines,
  loop,
  repo,
  root,
} from './deliver/run-loop';
import { type ProfileEvent, profileValidator } from '../../helpers/agent-events-profile.ts';

type Event = ProfileEvent & {
  run: string;
  seq: number;
  reason?: string;
  needsYou?: boolean;
  deliver: Record<string, unknown>;
};
const profile = profileValidator(
  'deliver@2',
  'skills/delivery/deliver/schema/deliver-profile.schema.json',
);

const overlap = (a: Span, b: Span) => a.at < b.end && b.at < a.end;
const implementer = (spans: Span[], id: number) => spans.find((s) => s.id === id && !s.review);

/** An Objective in `x/app` over `x/app`, `x/lib` and `x/cli`; `features` by repository. */
function objective(
  features: Record<
    string,
    { body?: string; milestone?: string; labels?: string[]; work: number[] }[]
  >,
  extra: Record<
    string,
    { number: number; title: string; labels?: string[]; addedAfter?: number }[]
  > = {},
  milestones: Record<string, { title: string; closed: boolean }[]> = {},
): Scenario {
  let next = 100;
  const repositories: Record<string, { issues: unknown[]; milestones?: unknown[] }> = {};
  const children: string[] = [];
  for (const name of ['x/app', 'x/lib', 'x/cli']) {
    const issues: unknown[] =
      name === 'x/app' ? [{ number: 1, title: '[Objective] o', labels: ['objective'] }] : [];
    for (const feature of features[name] ?? []) {
      next += 1;
      children.push(`${name}#${next}`);
      issues.push({
        number: next,
        title: '[Feature] f',
        milestone: feature.milestone ?? 'M001',
        body: feature.body ?? '',
        labels: ['feature', ...(feature.labels ?? [])],
        subIssues: [...feature.work, ...(extra[name] ?? []).map((i) => i.number)],
      });
      for (const nr of feature.work)
        issues.push({ number: nr, title: `[PBI] feat: work ${nr}`, labels: ['pbi'] });
    }
    for (const issue of extra[name] ?? []) issues.push({ labels: ['pbi'], ...issue });
    repositories[name] = {
      issues,
      milestones: milestones[name] ?? [{ title: 'M001', closed: false }],
    };
  }
  const objectiveIssue = repositories['x/app']?.issues[0] as Record<string, unknown>;
  objectiveIssue.body = '## Affected repos\n- x/app\n- x/lib\n- x/cli';
  objectiveIssue.subIssues = children;
  return { items: [], repositories };
}

describe('deliver-loop --objective', () => {
  fixture();
  let reposDir: string;
  beforeAll(() => {
    // every repository of the Objective is a copy of the fixture origin, with the head of the fake pull requests
    git(repo, 'push', '--quiet', 'origin', 'abc123');
    reposDir = path.join(root, 'remotes');
    for (const name of ['app', 'lib', 'cli']) {
      mkdirSync(path.join(reposDir, 'x'), { recursive: true });
      execFileSync('git', [
        'clone',
        '--quiet',
        '--bare',
        path.join(root, 'origin.git'),
        path.join(reposDir, 'x', `${name}.git`),
      ]);
    }
  });
  const run = (
    scenario: Scenario,
    extra: { parallel?: number; args?: string[]; env?: Record<string, string> } = {},
  ) =>
    loop(
      { sessionMs: 0, ...scenario },
      {
        args: ['--objective', 'x/app#1', '--no-retro', ...(extra.args ?? [])],
        parallel: extra.parallel ?? 2,
        env: { DELIVER_REPOS_DIR: reposDir, ...extra.env },
      },
    );

  it('runs two independent issues of different repositories at once', async () => {
    const out = await run({
      ...objective({ 'x/app': [{ work: [11] }], 'x/lib': [{ work: [21] }] }),
      sessionMs: 400,
    });
    expect(out.status, out.stdout + out.stderr).toBe(0);
    const [a, b] = [implementer(out.spans, 11), implementer(out.spans, 21)];
    expect(a && b && overlap(a, b)).toBe(true);
    expect(out.merges.map((m) => m.pull).sort((a, b) => a - b)).toEqual([111, 121]);
    expect(out.calls.filter((c) => c === 'releasePull')).toHaveLength(2);
    // a section per repository, then the verdict
    expect(out.stdout).toMatch(
      /x\/app\n  merged \(1\):\n    #11 [\s\S]*x\/cli\n  merged \(0\):[\s\S]*x\/lib\n  merged \(1\):\n    #21 /,
    );
    expect(out.stdout.trim().split('\n').pop()).toBe('done');
    // a repository without a Feature has nothing to do
    expect(out.stdout).toMatch(/x\/cli \(no unit\)/);
  });

  it('never runs more than maxSessions across repositories nor more than parallel in one', async () => {
    const out = await run(
      {
        ...objective({
          'x/app': [{ work: [14, 15] }],
          'x/lib': [{ work: [27, 28] }],
          'x/cli': [{ work: [34, 35] }],
        }),
        sessionMs: 300,
      },
      { parallel: 1, args: ['--max-sessions', '2'] },
    );
    expect(out.status, out.stdout + out.stderr).toBe(0);
    // the sessions running at the start of each one: the highest number at the same moment
    const peak = (spans: Span[]) =>
      Math.max(0, ...spans.map((s) => spans.filter((o) => o.at <= s.at && s.at < o.end).length));
    expect(peak(out.spans)).toBe(2);
    for (const tens of [1, 2, 3])
      expect(peak(out.spans.filter((s) => Math.floor(s.id / 10) === tens))).toBe(1);
  });

  it('starts a repository with an unreleased upstream milestone after the release, never before', async () => {
    const out = await run({
      ...objective({
        'x/app': [{ work: [12], body: 'Requires: x/lib@M001 released' }],
        'x/lib': [{ work: [22] }],
      }),
      releaseOnPull: ['x/lib'],
    });
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(out.stdout).toContain('x/app M001: upstream x/lib@M001 not released, waits');
    const [upstream, dependent] = [implementer(out.spans, 22), implementer(out.spans, 12)];
    expect(dependent?.at).toBeGreaterThanOrEqual(upstream?.end ?? Number.POSITIVE_INFINITY);
    expect(out.merges.map((m) => m.pull)).toEqual([122, 112]);
  });

  it('holds back only the dependents of a repository that waits for a person', async () => {
    const out = await run({
      ...objective({
        'x/app': [{ work: [13], body: 'Requires: x/lib@M001 released' }],
        'x/lib': [{ work: [23] }],
        'x/cli': [{ work: [33] }],
      }),
      // the release of x/lib waits for its release test: a person tests it and merges the release pull request
      releaseTests: [90],
    });
    expect(out.status, out.stdout + out.stderr).toBe(3);
    expect(out.merges.map((m) => m.pull).sort((a, b) => a - b)).toEqual([123, 133]);
    expect(implementer(out.spans, 13)).toBeUndefined();
    expect(out.stdout).toMatch(
      /x\/app\n[\s\S]*?waiting \(1\):\n    M001: upstream x\/lib@M001 not released\n[\s\S]*?needs you \(1\):\n    M001: upstream/,
    );
    expect(out.stdout).toMatch(/x\/lib\n[\s\S]*needs you \(1\):\n    M001: #90/);
    expect(out.stdout.trim().split('\n').pop()).toBe('needs you: nothing else can start');
  });

  it('works an item added during the run and skips a deferred Feature', async () => {
    const out = await run(
      {
        ...objective(
          { 'x/lib': [{ work: [24] }, { work: [25], labels: ['deferred'] }] },
          { 'x/lib': [{ number: 26, title: '[PBI] feat: added later', addedAfter: 24 }] },
        ),
      },
      { parallel: 1 },
    );
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(out.merges.map((m) => m.pull)).toEqual([124, 126]);
    expect(implementer(out.spans, 25)).toBeUndefined();
  });

  it('stops every repository with one stop file and resumes each where it stopped', async () => {
    const scenario = objective({
      'x/app': [{ work: [41] }],
      'x/lib': [{ work: [42] }],
      'x/cli': [{ work: [43] }],
    });
    let stopped = false;
    // x/cli merges its issue, x/app hangs in its review, x/lib hangs in its implementer session
    const first = await loop(
      { sessionMs: 0, ...scenario, hangsOn: ['review:41', '42'] },
      {
        args: ['--objective', 'x/app#1', '--no-retro', '--max-sessions', '3'],
        env: { DELIVER_REPOS_DIR: reposDir },
        whenStdout: (stdout) => {
          const file = /stop file: (.+)/.exec(stdout)?.[1];
          const hanging = stdout.match(/\[x\/(app|lib)\] {3}working/g)?.length ?? 0;
          if (stopped || !file || hanging < 2 || !stdout.includes('#43 merged:')) return;
          stopped = true;
          writeFileSync(file, '');
        },
      },
    );
    expect(first.status, first.stdout + first.stderr).toBe(130);
    expect(first.merges.map((m) => m.pull)).toEqual([143]);
    // no session of the run is alive
    for (const { pid } of first.spans) expect(() => process.kill(pid, 0)).toThrow(/ESRCH/);
    // each stopped item keeps the label of its stage
    const stageOf = (id: number) => first.stages.filter((s) => s.id === id).at(-1)?.stage;
    expect([stageOf(41), stageOf(42), stageOf(43)]).toEqual(['review', 'implementing', null]);

    const second = await loop(
      { sessionMs: 0, ...scenario },
      {
        args: ['--objective', 'x/app#1', '--no-retro', '--max-sessions', '3'],
        env: { DELIVER_REPOS_DIR: reposDir },
        resume: first.dir,
      },
    );
    expect(second.status, second.stdout + second.stderr).toBe(0);
    expect(second.merges.map((m) => m.pull).sort()).toEqual([141, 142, 143]);
    expect(second.stdout).toContain('#41 resumes at the review');
    // both runs together: #41 was built once, #43 is not touched again, #42 got one new implementer session
    const started = (review: boolean) =>
      second.spans
        .filter((s) => s.review === review)
        .map((s) => s.id)
        .sort();
    expect(started(false)).toEqual([41, 42, 42, 43]);
    expect(started(true)).toEqual([41, 41, 42, 43]);
    // every repository syncs its labels in both runs
    expect(second.calls.filter((c) => c === 'syncStageLabels')).toHaveLength(6);
  });

  it('writes one run folder and one events run for two repositories', async () => {
    const out = await run(
      objective({
        'x/app': [{ work: [16], body: 'Requires: x/lib@M001 released' }],
        'x/lib': [{ work: [16] }],
      }),
    );
    // nothing releases x/lib: x/app waits for it
    expect(out.status, out.stdout + out.stderr).toBe(3);
    const events = out.events as unknown as Event[];
    profile.expectRun(events);
    const dir = path.join(path.dirname(out.eventsFile), 'deliver');
    const folder = path.join(dir, readdirSync(dir)[0]!);
    expect(lines<{ issue?: number }>(path.join(folder, 'x/lib/results.jsonl'))[0]).toMatchObject({
      issue: 16,
      outcome: 'merged',
    });
    // one run: gapless, one start that names the Objective, one end
    expect(events.map((e) => [e.run, e.seq])).toEqual(
      events.map((_, i) => [events[0]!.run, i + 1]),
    );
    expect(events[0]).toMatchObject({
      type: 'run.started',
      deliver: { objective: 'x/app#1' },
      subject: { id: 'x/app#1', title: '[Objective] o' },
    });
    expect(events.filter((e) => e.type.startsWith('run.')).map((e) => e.type)).toEqual([
      'run.started',
      'run.finished',
    ]);
    for (const event of events) expect(event.deliver).toMatchObject({ objective: 'x/app#1' });
    for (const event of events.filter((e) => !e.type.startsWith('run.')))
      expect(event.deliver).toHaveProperty('repo', expect.stringMatching(/^x\//));
    expect(events.find((e) => e.type === 'task.started')).toMatchObject({
      task: 'x/lib:issue-16',
      deliver: { repo: 'x/lib' },
    });
    expect(events.find((e) => e.type === 'deliver.merged')).toMatchObject({
      deliver: { repo: 'x/lib', issue: 16 },
    });
    const waits = events.filter((e) => e.reason === 'deliver.waiting-upstream');
    expect(waits.map((e) => e.needsYou)).toEqual([false, true]);
    expect(waits[1]).toMatchObject({
      type: 'attention',
      text: 'x/app M001: upstream x/lib@M001 not released',
      deliver: { objective: 'x/app#1', repo: 'x/app' },
    });
  });

  it('reports an Objective with only deferred Features open as partly released', async () => {
    const out = await run(objective({ 'x/lib': [{ work: [29], labels: ['deferred'] }] }));
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(out.stdout).toMatch(/x\/lib\n[\s\S]*?deferred \(1\):\n    #101 \[Feature\] f\n/);
    expect(out.stdout.trim().split('\n').pop()).toBe('partly released');
    expect(out.events.at(-1)).toMatchObject({
      type: 'run.finished',
      outcome: 'succeeded',
      text: expect.stringMatching(/^partly released:/),
    });
  });
});
