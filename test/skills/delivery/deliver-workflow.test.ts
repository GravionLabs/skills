import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const script = fs
  .readFileSync(path.resolve(__dirname, '../../../skills/delivery/deliver/workflow.js'), 'utf8')
  .replace('export const meta =', 'const meta =');

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

interface Call {
  label: string;
  prompt: string;
  opts: Record<string, unknown>;
}
type Handler = (call: Call, n: number) => unknown;

// Runs workflow.js with stubbed workflow globals; `handlers` answers an agent() call by the role prefix of its label.
async function run(args: unknown, handlers: Record<string, Handler>) {
  const calls: Call[] = [];
  const logs: string[] = [];
  const counts: Record<string, number> = {};
  const agent = async (prompt: string, opts: Record<string, unknown> = {}) => {
    const label = String(opts.label);
    const role = label.split(' ')[0];
    const call = { label, prompt, opts };
    calls.push(call);
    counts[role] = (counts[role] ?? 0) + 1;
    const h = handlers[role];
    if (!h) throw new Error(`no handler for ${label}`);
    return h(call, counts[role]);
  };
  const pipeline = (
    items: unknown[],
    ...stages: Array<(r: unknown, it: unknown, i: number) => unknown>
  ) =>
    Promise.all(
      items.map(async (it, i) => {
        let r = it;
        for (const s of stages) r = await s(r, it, i);
        return r;
      }),
    );
  const fn = new AsyncFunction('args', 'agent', 'pipeline', 'parallel', 'phase', 'log', script);
  const result = await fn(
    args,
    agent,
    pipeline,
    undefined,
    () => {},
    (m: string) => logs.push(m),
  );
  return { result, calls, logs };
}

const pbi = (nr: number, extra: Record<string, unknown> = {}) => ({
  nr,
  title: `feat: pbi ${nr}`,
  tier: 'standard',
  branch: `feat/${nr}-pbi`,
  blocked_by: [],
  ...extra,
});
const select = (pbis: unknown[], extra: Record<string, unknown> = {}) => ({
  level: 'Feature',
  pbis,
  missing: [],
  skipped: [],
  ...extra,
});
const green = { green: true, commands: ['pnpm test'] };
const clean = { blocking: [], unmet: [], notes: ['rename x'] };
const prOk = (call: Call) => ({ pr: 7, url: `https://example/pull/${call.label.split('#')[1]}` });
const merged = { state: 'merged' };
const impl = { status: 'ok' };

const happy = (pbis: unknown[]): Record<string, Handler> => ({
  select: () => select(pbis),
  implement: () => impl,
  gate: () => green,
  review: () => clean,
  fix: () => impl,
  pr: prOk,
  ci: () => merged,
});

describe('deliver workflow.js', () => {
  it('rejects a missing issue number', async () => {
    await expect(run({}, {})).rejects.toThrow('args.issue must be an issue number');
  });

  it('delivers a PBI through implement, gate, review, pr and ci in order', async () => {
    const { result, calls } = await run({ issue: 12 }, happy([pbi(12)]));
    expect(calls.map((c) => c.label)).toEqual([
      'select #12',
      'implement #12',
      'gate #12',
      'review #12',
      'pr #12',
      'ci #12',
    ]);
    expect(result).toEqual({
      status: 'done',
      delivered: [{ nr: 12, pr: 'https://example/pull/12' }],
      blocked: [],
      skipped: [],
    });
  });

  it('puts review notes and gate commands into the PR prompt', async () => {
    const { calls } = await run({ issue: 12 }, happy([pbi(12)]));
    const pr = calls.find((c) => c.label === 'pr #12')!;
    expect(pr.prompt).toContain('- rename x');
    expect(pr.prompt).toContain('- pnpm test');
    expect(pr.prompt).toContain('Closes #12');
  });

  it('resumes an earlier branch and reuses an open PR', async () => {
    const { calls } = await run({ issue: 12 }, happy([pbi(12)]));
    const prompt = (label: string) => calls.find((c) => c.label === label)?.prompt;
    expect(prompt('implement #12')).toContain('git rebase origin/release/next');
    expect(prompt('pr #12')).toContain('reuse it');
  });

  it('gives every call a model by role and tier, and a worktree to the code roles', async () => {
    const { calls } = await run({ issue: 3 }, happy([pbi(3, { tier: 'strong' })]));
    const by = Object.fromEntries(calls.map((c) => [c.label.split(' ')[0], c.opts]));
    expect(by.implement).toMatchObject({ model: 'opus', effort: 'high', isolation: 'worktree' });
    expect(by.gate).toMatchObject({ model: 'haiku', effort: 'low', isolation: 'worktree' });
    expect(by.review).toMatchObject({ model: 'sonnet', effort: 'medium' });
    expect(by.pr).toMatchObject({ model: 'haiku' });
    expect(by.pr).not.toHaveProperty('isolation');
  });

  it('applies deliver.roles over the defaults and leaves unset keys alone', async () => {
    const roles = {
      review: { model: 'opus', effort: 'max' },
      implement: { tiers: { standard: { model: 'fable' } } },
    };
    const { calls } = await run({ issue: 3, roles }, happy([pbi(3)]));
    const by = Object.fromEntries(calls.map((c) => [c.label.split(' ')[0], c.opts]));
    expect(by.review).toMatchObject({ model: 'opus', effort: 'max' });
    expect(by.implement).toMatchObject({ model: 'fable', effort: 'medium' });
    expect(by.gate).toMatchObject({ model: 'haiku' });
  });

  it('omits model and effort for a role without a default', async () => {
    const { calls } = await run(
      { issue: 5 },
      {
        select: () => select([], { missing: [{ nr: 5, level: 'Feature' }] }),
        plan: () => ({
          plan: '{}',
          questions: [
            { id: 'q1', question: 'x?', options: ['a', 'b'], recommended: 'a', why: 'w' },
          ],
        }),
      },
    );
    const plan = calls.find((c) => c.label === 'plan #5')!;
    expect(plan.opts).not.toHaveProperty('model');
    expect(plan.opts).not.toHaveProperty('effort');
  });

  it('stops with the open questions of the planner and creates nothing', async () => {
    const q = {
      id: 'q1',
      question: 'Which db?',
      options: ['pg', 'sqlite'],
      recommended: 'pg',
      why: 'w',
    };
    const { result, calls } = await run(
      { issue: 5 },
      {
        select: () => select([], { missing: [{ nr: 5, level: 'Feature' }] }),
        plan: () => ({ plan: '{}', questions: [q] }),
      },
    );
    expect(result).toEqual({ status: 'questions', questions: [{ target: 5, ...q }] });
    expect(calls.map((c) => c.label)).toEqual(['select #5', 'plan #5']);
  });

  it('plans with given answers, creates the issues and selects again', async () => {
    const answers = { 5: [{ question: 'Which db?', answer: 'pg' }] };
    let selects = 0;
    const { result, calls } = await run(
      { issue: 5, answers },
      {
        ...happy([pbi(31)]),
        select: () =>
          ++selects === 1
            ? select([], { missing: [{ nr: 5, level: 'Feature' }] })
            : select([pbi(31)]),
        plan: () => ({ plan: '{"items":[]}', questions: [] }),
        create: () => ({ created: [31] }),
      },
    );
    expect(calls.find((c) => c.label === 'plan #5')!.prompt).toContain('- Which db? — pg');
    expect(calls.find((c) => c.label === 'create #5')!.prompt).toContain('{"items":[]}');
    expect(calls.map((c) => c.label.split(' ')[0])).toEqual([
      'select',
      'plan',
      'create',
      'select',
      'implement',
      'gate',
      'review',
      'pr',
      'ci',
    ]);
    expect((result as { delivered: unknown[] }).delivered).toHaveLength(1);
  });

  it('skips a Feature that still has no breakdown after planning', async () => {
    const missing = [{ nr: 5, level: 'Feature' }];
    const { result } = await run(
      { issue: 5 },
      {
        select: () => select([], { missing }),
        plan: () => ({ plan: '{}', questions: [] }),
        create: () => ({ created: [] }),
      },
    );
    expect(result).toMatchObject({ skipped: [{ nr: 5, reason: 'no breakdown after planning' }] });
  });

  it('fixes a red gate and a blocking review finding, then continues', async () => {
    let gates = 0;
    let reviews = 0;
    const { result, calls } = await run(
      { issue: 8 },
      {
        ...happy([pbi(8)]),
        gate: () =>
          ++gates === 1 ? { green: false, commands: ['pnpm test'], failure_tail: 'boom' } : green,
        review: () =>
          ++reviews === 1 ? { blocking: ['🔴 null deref'], unmet: ['AC 2'], notes: [] } : clean,
      },
    );
    const fixes = calls.filter((c) => c.label === 'fix #8');
    expect(fixes).toHaveLength(2);
    expect(fixes[0].prompt).toContain('boom');
    expect(fixes[1].prompt).toContain('unmet criterion: AC 2');
    expect((result as { delivered: unknown[] }).delivered).toHaveLength(1);
  });

  it('blocks after two fix rounds without opening a PR', async () => {
    const { result, calls } = await run(
      { issue: 8 },
      { ...happy([pbi(8)]), gate: () => ({ green: false, commands: [], failure_tail: 'red' }) },
    );
    expect(calls.filter((c) => c.label === 'fix #8')).toHaveLength(2);
    expect(calls.some((c) => c.label === 'pr #8')).toBe(false);
    expect(result).toMatchObject({
      delivered: [],
      blocked: [{ nr: 8, reason: expect.stringContaining('gate not clean after 2 fix rounds') }],
    });
  });

  it('honours maxFixRounds', async () => {
    const { calls } = await run(
      { issue: 8, maxFixRounds: 1 },
      { ...happy([pbi(8)]), gate: () => ({ green: false, commands: [], failure_tail: 'red' }) },
    );
    expect(calls.filter((c) => c.label === 'fix #8')).toHaveLength(1);
  });

  it('blocks the PBI when implementation reports a blocker and goes on', async () => {
    const { result } = await run(
      { issue: 1 },
      {
        ...happy([pbi(1), pbi(2)]),
        implement: (c) =>
          c.label === 'implement #1' ? { status: 'blocked', reason: 'AC 3 impossible' } : impl,
      },
    );
    expect(result).toMatchObject({
      delivered: [{ nr: 2 }],
      blocked: [{ nr: 1, reason: 'AC 3 impossible' }],
    });
  });

  it('blocks dependents of a failed PBI and external open blockers, not independent ones', async () => {
    const { result, calls } = await run(
      { issue: 1 },
      {
        ...happy([pbi(1), pbi(2, { blocked_by: [1] }), pbi(3), pbi(4, { blocked_by: [99] })]),
        implement: (c) =>
          c.label === 'implement #1' ? { status: 'blocked', reason: 'nope' } : impl,
      },
    );
    expect(result).toMatchObject({
      delivered: [{ nr: 3 }],
      blocked: [
        { nr: 1, reason: 'nope' },
        { nr: 2, reason: 'blocked by #1 not delivered' },
        { nr: 4, reason: 'blocked by #99 is open' },
      ],
    });
    expect(calls.some((c) => c.label === 'implement #2')).toBe(false);
  });

  it('runs a dependent after its blocker is delivered', async () => {
    const { result } = await run({ issue: 1 }, happy([pbi(1), pbi(2, { blocked_by: [1] })]));
    expect(result).toMatchObject({ delivered: [{ nr: 1 }, { nr: 2 }], blocked: [] });
  });

  it('fixes a red CI caused by the change and waits again', async () => {
    let cis = 0;
    const { result, calls } = await run(
      { issue: 4 },
      {
        ...happy([pbi(4)]),
        ci: () =>
          ++cis === 1
            ? { state: 'red', caused_by_change: true, failure_tail: 'lint error' }
            : merged,
      },
    );
    expect(calls.filter((c) => c.label === 'fix #4')[0].prompt).toContain('lint error');
    expect(calls.filter((c) => c.label === 'ci #4')).toHaveLength(2);
    expect((result as { delivered: unknown[] }).delivered).toHaveLength(1);
  });

  it('runs gate and review again after a CI fix and updates the PR before waiting', async () => {
    let cis = 0;
    let reviews = 0;
    const { calls } = await run(
      { issue: 4 },
      {
        ...happy([pbi(4)]),
        review: () => ({ blocking: [], unmet: [], notes: [`note ${++reviews}`] }),
        ci: () =>
          ++cis === 1
            ? { state: 'red', caused_by_change: true, failure_tail: 'lint error' }
            : merged,
      },
    );
    expect(calls.map((c) => c.label)).toEqual([
      'select #4',
      'implement #4',
      'gate #4',
      'review #4',
      'pr #4',
      'ci #4',
      'fix #4',
      'gate #4',
      'review #4',
      'pr #4',
      'ci #4',
    ]);
    expect(calls.filter((c) => c.label === 'pr #4')[1].prompt).toContain('- note 2');
  });

  it('shares the fix rounds between CI, gate and review', async () => {
    // ci red → fix 1 → review blocking → fix 2 → review clean → pr → ci merged
    let cis = 0;
    let reviews = 0;
    const { result, calls } = await run(
      { issue: 4 },
      {
        ...happy([pbi(4)]),
        review: () =>
          ++reviews === 2 ? { blocking: ['🔴 regression'], unmet: [], notes: [] } : clean,
        ci: () =>
          ++cis === 1
            ? { state: 'red', caused_by_change: true, failure_tail: 'lint error' }
            : merged,
      },
    );
    expect(calls.filter((c) => c.label === 'fix #4')).toHaveLength(2);
    expect((result as { delivered: unknown[] }).delivered).toHaveLength(1);
  });

  it('blocks with the PR URL when the review stays red after a CI fix', async () => {
    let cis = 0;
    let reviews = 0;
    const { result, calls } = await run(
      { issue: 4, maxFixRounds: 1 },
      {
        ...happy([pbi(4)]),
        review: () =>
          ++reviews === 1 ? clean : { blocking: ['🔴 regression'], unmet: [], notes: [] },
        ci: () => ({ state: 'red', caused_by_change: true, failure_tail: 'lint error' }),
      },
    );
    expect(calls.filter((c) => c.label === 'ci #4')).toHaveLength(1);
    expect(result).toMatchObject({
      delivered: [],
      blocked: [
        {
          nr: 4,
          reason: expect.stringContaining('review not clean after 1 fix rounds'),
          pr: 'https://example/pull/4',
        },
      ],
    });
  });

  it('leaves the PR open and reports it when CI is red for another reason', async () => {
    const { result, calls } = await run(
      { issue: 4 },
      {
        ...happy([pbi(4)]),
        ci: () => ({
          state: 'red',
          caused_by_change: false,
          failure_tail: 'flake',
          reason: 'flaky job',
        }),
      },
    );
    expect(calls.some((c) => c.label === 'fix #4')).toBe(false);
    expect(result).toMatchObject({
      blocked: [{ nr: 4, reason: 'flaky job', pr: 'https://example/pull/4' }],
    });
  });

  it('reports a denied merge with the PR', async () => {
    const { result } = await run(
      { issue: 4 },
      { ...happy([pbi(4)]), ci: () => ({ state: 'denied', reason: 'merge not permitted' }) },
    );
    expect(result).toMatchObject({
      blocked: [{ nr: 4, reason: 'merge not permitted', pr: 'https://example/pull/4' }],
    });
  });

  it('turns a subagent that returns nothing into a blocked PBI instead of aborting the run', async () => {
    const { result } = await run(
      { issue: 1 },
      { ...happy([pbi(1), pbi(2)]), gate: (c) => (c.label === 'gate #1' ? null : green) },
    );
    expect(result).toMatchObject({
      delivered: [{ nr: 2 }],
      blocked: [{ nr: 1, reason: 'gate agent returned nothing' }],
    });
  });

  it('logs every step of a delivered PBI', async () => {
    const { logs } = await run({ issue: 12 }, happy([pbi(12)]));
    expect(logs).toEqual([
      '#12 implement ok',
      '#12 gate green',
      '#12 review clean',
      '#12 PR https://example/pull/12, waiting for CI',
      '#12 delivered: https://example/pull/12',
    ]);
  });

  it('logs gate, review and CI fix rounds with the round count', async () => {
    let gates = 0;
    let reviews = 0;
    let cis = 0;
    const { logs } = await run(
      { issue: 8, maxFixRounds: 3 },
      {
        ...happy([pbi(8)]),
        gate: () =>
          ++gates === 1 ? { green: false, commands: ['pnpm test'], failure_tail: 'boom' } : green,
        review: () =>
          ++reviews === 1 ? { blocking: ['🔴 null deref'], unmet: ['AC 2'], notes: [] } : clean,
        ci: () =>
          ++cis === 1
            ? { state: 'red', caused_by_change: true, failure_tail: 'lint error' }
            : merged,
      },
    );
    expect(logs).toEqual([
      '#8 implement ok',
      '#8 gate red → fix 1/3',
      '#8 gate green',
      '#8 review: 1 blocking, 1 unmet → fix 2/3',
      '#8 gate green',
      '#8 review clean',
      '#8 PR https://example/pull/8, waiting for CI',
      '#8 CI red, caused by the change → fix 3/3',
      '#8 gate green',
      '#8 review clean',
      '#8 PR https://example/pull/8, waiting for CI',
      '#8 delivered: https://example/pull/8',
    ]);
  });

  it('logs no fix round when the rounds are used up, only the blocked line', async () => {
    const { logs } = await run(
      { issue: 8, maxFixRounds: 0 },
      { ...happy([pbi(8)]), gate: () => ({ green: false, commands: [], failure_tail: 'red' }) },
    );
    expect(logs).toEqual(['#8 implement ok', '#8 blocked: gate not clean after 0 fix rounds: red']);
  });

  it('reports skipped issues from the selection', async () => {
    const skipped = [{ nr: 9, reason: 'needs-decision' }];
    const { result } = await run(
      { issue: 1 },
      { ...happy([]), select: () => select([], { skipped }) },
    );
    expect(result).toEqual({ status: 'done', delivered: [], blocked: [], skipped });
  });
});
