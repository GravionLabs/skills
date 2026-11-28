// The triage of an Objective run (#1127): each attention case of a unit starts one `deliver-triage` session, and the
// loop applies its result through `parseTriage`. The fake harness answers from `scenario.triage` (by case kind).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type Outcome,
  type Scenario,
  fixture,
  git,
  lines,
  loop,
  repo,
  root,
} from './deliver/run-loop';
import { objective } from './deliver/objective-scenario';
import { type ProfileEvent, profileValidator } from '../../helpers/agent-events-profile.ts';

type Event = ProfileEvent & { deliver: Record<string, unknown> };
const profile = profileValidator(
  'deliver@2',
  'skills/delivery/deliver/schema/deliver-profile.schema.json',
);

/** The triage events of the run: `[type, case, issue, action]`. */
const triageEvents = (out: Outcome) =>
  (out.events as unknown as Event[])
    .filter((e) => e.type.startsWith('deliver.triage.'))
    .map((e) => [e.type, e.deliver.case, e.deliver.issue, e.deliver.action]);
const cases = (out: Outcome) => out.triages.map((t) => `${t.case.kind} ${t.case.issue ?? '-'}`);
const callsOf = (out: Outcome, call: string) =>
  lines<Record<string, unknown>>(path.join(out.dir, 'calls.jsonl')).filter((c) => c.call === call);

describe('deliver-loop --objective: triage of attention cases', () => {
  fixture();
  let reposDir: string;
  beforeAll(() => {
    git(repo, 'push', '--quiet', 'origin', 'abc123');
    reposDir = path.join(root, 'remotes');
    mkdirSync(path.join(reposDir, 'x'), { recursive: true });
    for (const name of ['app', 'lib', 'cli'])
      execFileSync('git', [
        'clone',
        '--quiet',
        '--bare',
        path.join(root, 'origin.git'),
        path.join(reposDir, 'x', `${name}.git`),
      ]);
  });
  const run = (scenario: Scenario, parallel = 2) =>
    loop(
      { sessionMs: 0, ...scenario },
      {
        args: ['--objective', 'x/app#1', '--no-retro'],
        parallel,
        env: { DELIVER_REPOS_DIR: reposDir },
      },
    );
  // the session asks a question: the issue is set aside with needs-decision
  const decision = (work: number[], triage: Record<string, unknown>): Scenario => ({
    ...objective({ 'x/lib': [{ work }] }),
    needsDecision: true,
    noPull: true,
    triage,
  });

  it('answers a needs-decision: posts the comment and removes the label', async () => {
    const out = await run(
      decision([51], {
        'needs-decision': { action: 'answer', answer: 'Yes, it does.', evidence: ['a.ts:1'] },
      }),
    );
    // the issue stays aside in this run: the milestone is not done
    expect(out.status, out.stdout + out.stderr).toBe(2);
    expect(cases(out)).toEqual(['needs-decision 51', 'milestone-done -']);
    expect(out.comments.find((c) => c.marker === '<!-- deliver-triage: answer -->')).toMatchObject({
      id: 51,
      body: expect.stringContaining('Yes, it does.\n\nEvidence:\n- a.ts:1'),
    });
    expect(callsOf(out, 'removeLabel')).toEqual([
      { call: 'removeLabel', id: 51, label: 'needs-decision', repo: 'x/lib' },
    ]);
    expect(out.stdout).toMatch(/triaged \(1\):\n {4}#51 answered: needs-decision removed/);
    expect(triageEvents(out)).toEqual([
      ['deliver.triage.started', 'needs-decision', 51, undefined],
      ['deliver.triage.done', 'needs-decision', 51, 'answer'],
      ['deliver.triage.started', 'milestone-done', undefined, undefined],
      ['deliver.triage.done', 'milestone-done', undefined, 'needs-owner'],
    ]);
    profile.expectRun(out.events as unknown as Event[]);
    // triage never writes a stage label: only the loop's own stages of #51
    expect(out.stages.every((s) => s.id === 51)).toBe(true);
  });

  it('drops a handed-over item from the run with the reason in the summary', async () => {
    const out = await run({
      ...objective({ 'x/lib': [{ work: [52] }] }),
      twoPulls: [52],
      triage: { handover: { action: 'drop', reason: 'needs a release of x/app first' } },
    });
    expect(out.status, out.stdout + out.stderr).toBe(0);
    expect(cases(out)).toEqual(['handover 52']);
    expect(out.stdout).toMatch(
      /triaged \(1\):\n {4}#52 dropped from the run: needs a release of x\/app first\n {2}needs you \(0\)/,
    );
    expect(out.merges).toEqual([]);
  });

  it('puts a drafted follow-up and a refused action of a high-risk hand-over to needs you', async () => {
    const out = await run({
      ...objective({ 'x/lib': [{ work: [53] }], 'x/cli': [{ work: [54] }] }),
      twoPulls: [53],
      risks: { 54: 'high' },
      triage: {
        handover: { action: 'draft-issue', title: '[PBI] feat: follow-up', body: '## Overview\nx' },
        'handover 54': { action: 'drop', reason: 'not needed now' },
      },
    });
    expect(out.status, out.stdout + out.stderr).toBe(3);
    const drafted = /#53 follow-up drafted: \[PBI\] feat: follow-up \((\S+)\)/.exec(out.stdout);
    expect(drafted).not.toBeNull();
    expect(readFileSync(drafted![1]!, 'utf8')).toMatch(
      /^# \[PBI\] feat: follow-up\n[\s\S]*## Overview/,
    );
    // a hand-over of risk high is the owner's: the loop applies the draft, never a drop or an answer
    expect(callsOf(out, 'merge')).toEqual([]);
    expect(out.triages.find((t) => t.case.issue === 54)?.case).toMatchObject({
      kind: 'handover',
      reason: 'deliver.merge-risk',
    });
    expect(out.stdout).toMatch(
      /#54 decide: drop refused: the case is the owner's \(deliver\.merge-risk\)/,
    );
    expect(out.stdout).not.toMatch(/#54 dropped/);
  });

  it('re-runs a CI job once per run and counts triage sessions toward deliver.parallel', async () => {
    const out = await run(
      {
        ...decision([55, 56], {
          'needs-decision': { action: 'rerun-ci', job: 7, reason: 'the runner lost its network' },
        }),
        sessionMs: 100,
      },
      1,
    );
    expect(out.status, out.stdout + out.stderr).toBe(2);
    expect(callsOf(out, 'rerunJob')).toEqual([{ call: 'rerunJob', job: 7, repo: 'x/lib' }]);
    expect(out.stdout).toMatch(/#55 CI job 7 re-run: the runner lost its network/);
    expect(out.stdout).toMatch(
      /#56 decide: rerun-ci refused: job 7 was re-run in this run already/,
    );
    // one triage per case, and with --parallel 1 no triage runs beside another session of the repository
    expect(cases(out)).toEqual(['needs-decision 55', 'needs-decision 56', 'milestone-done -']);
    const ends = new Map(
      lines<{ pid: number; at: number }>(path.join(out.dir, 'ends.jsonl')).map((e) => [
        e.pid,
        e.at,
      ]),
    );
    const spans = [
      ...out.spans,
      ...out.triages.map((t) => ({ at: t.at, end: ends.get(t.pid) ?? Infinity })),
    ];
    for (const a of spans)
      for (const b of spans) if (a !== b) expect(a.at < b.end && b.at < a.end).toBe(false);
  });

  it('turns an invalid or missing result into needs you', async () => {
    const out = await run(
      decision([57], { 'needs-decision': 'invalid', 'milestone-done': 'fail' }),
    );
    expect(out.status, out.stdout + out.stderr).toBe(2);
    const needs = out.stdout.slice(out.stdout.lastIndexOf('needs you ('));
    expect(needs).toMatch(/#57 decide: invalid triage result: not JSON \((\S+\.md)\)/);
    expect(needs).toMatch(/milestone M001 decide: triage failed: session failed \(exit 1\)/);
    expect(callsOf(out, 'removeLabel')).toEqual([]);
    const file = /#57 decide: .* \((\S+\.md)\)/.exec(needs)![1]!;
    expect(existsSync(file)).toBe(true);
  });

  it('starts no triage in a plain --milestone run', async () => {
    const out = await loop(
      { items: [{ id: 58, title: '[PBI] feat: x' }], needsDecision: true, noPull: true },
      { milestone: true },
    );
    expect(out.status, out.stdout + out.stderr).toBe(2);
    expect(out.triages).toEqual([]);
  });
});
