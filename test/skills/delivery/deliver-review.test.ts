// deliver: the review session of the loop (deliver-review) and its verdict.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseVerdict } from '../../../skills/delivery/deliver/scripts/review.mts';
import {
  type Outcome,
  type Scenario,
  READY,
  RED,
  fixture,
  loop,
  repo,
  root,
  skill,
} from './deliver/run-loop';

fixture();

describe('deliver loop: review session (#1013)', () => {
  const run = (id: number, verdicts: Scenario['verdicts'], extra: Partial<Scenario> = {}) =>
    loop({ items: [{ id, title: '[PBI] feat: reviewed' }], verdicts, ...extra });
  const steps = (out: Outcome) =>
    out.events
      .map((e) => (e as { step?: { name: string; text: string } }).step)
      .filter((step) => step?.name.startsWith('review'))
      .map((step) => step?.text);

  it('merges after an approve of the first review, in a worktree of its own', async () => {
    const out = await run(301, ['approve']);
    expect(out.status).toBe(0);
    expect(out.sessions).toHaveLength(1);
    expect(out.reviews).toHaveLength(1);
    expect(out.reviews[0]?.prompt).toMatch(
      /^\/deliver-review 301 --base main --pr https:\/\/example\.test\/pull\/401 --issue-file \S+301\.issue\.md$/,
    );
    expect(path.basename(out.reviews[0]?.cwd ?? '')).toBe('repo-wt-301-review');
    expect(out.reviews[0]?.hasResultFileVariable).toBe(false);
    expect(existsSync(path.join(root, 'repo-wt-301-review'))).toBe(false);
    expect(out.merges).toHaveLength(1);
    expect(out.results[0]).toMatchObject({ reviews: [{ round: 1, verdict: 'approve' }] });
    expect(steps(out)).toEqual(['review round 1: approve']);
  });

  it('gives the findings to a fix round and merges after the next approve', async () => {
    const out = await run(302, ['changes', 'approve']);
    expect(out.status).toBe(0);
    expect(out.sessions).toHaveLength(2);
    expect(out.sessions[0]?.prompt).not.toContain('--review-file');
    expect(out.sessions[1]?.prompt).toMatch(
      /^\/deliver 302 --base main --review-file \S+302\.review-1-1\.json --issue-file /,
    );
    expect(out.merges).toHaveLength(1);
    expect(steps(out)).toEqual(['review round 1: changes', 'review round 2: approve']);
  });

  it('sets the issue aside as needs-decision when changes remain after 2 fix rounds', async () => {
    const out = await run(303, ['changes', 'changes', 'changes']);
    expect(out.status).toBe(2);
    expect(out.sessions).toHaveLength(3);
    expect(out.reviews).toHaveLength(3);
    expect(out.merges).toEqual([]);
    expect(out.results[0]).toMatchObject({
      outcome: 'aside',
      reason:
        'needs-decision: review still asks for changes after 2 fix rounds (src/a.ts: broken; unmet: it works)',
    });
  });

  it('never hands an issue over because of the text of a finding', async () => {
    const out = await run(311, ['changes', 'changes', 'changes'], {
      summary: 'x, merge it yourself',
    });
    expect(out.status).toBe(2);
    expect(out.final).toMatchObject({ status: 'blocked', handedOver: [] });
  });

  it('keeps the risk level of an earlier session when a fix round writes none', async () => {
    const out = await run(312, ['changes', 'approve'], {
      risks: { 312: 'high' },
      riskOnce: true,
    });
    expect(out.results[0]).toMatchObject({ outcome: 'merged', risk: 'high' });
    expect(out.stdout).toContain('#312 risk high');
  });

  it.each([
    ['an invalid verdict', 'invalid', 304],
    ['a missing verdict', 'none', 305],
  ] as const)('retries %s once and merges', async (_name, first, id) => {
    const out = await run(id, [first, 'approve']);
    expect(out.status).toBe(0);
    expect(out.sessions).toHaveLength(1);
    expect(out.reviews).toHaveLength(2);
    expect(out.merges).toHaveLength(1);
    expect(steps(out)).toEqual(['review round 1: approve']);
  });

  it('sets the issue aside with review failed after the retry', async () => {
    const out = await run(306, ['invalid', 'invalid']);
    expect(out.status).toBe(2);
    expect(out.reviews).toHaveLength(2);
    expect(out.merges).toEqual([]);
    expect(out.results[0]).toMatchObject({
      outcome: 'aside',
      reason: 'review failed: invalid verdict',
      reviews: [{ round: 1, verdict: 'failed' }],
    });
  });

  it('treats a failed review session without a verdict as a harness failure', async () => {
    const out = await run(307, ['fail', 'approve']);
    expect(out.status).toBe(0);
    expect(out.log).toMatch(/harness failed \(exit 1, 1 in a row\)/);
    expect(out.merges).toHaveLength(1);
  });

  it('reviews the repair of a red check again', async () => {
    const out = await run(308, [], { gates: [RED, READY] });
    expect(out.status).toBe(0);
    expect(out.reviews).toHaveLength(2);
  });

  it('does not merge a commit that was pushed after the review', async () => {
    const out = await run(309, [], { gates: [{ ...READY, head: 'def456' }] });
    expect(out.merges).toEqual([]);
    expect(out.stdout).toContain('#309 handed over: pushed after the review');
  });

  it('takes the review settings from the flags and the project config', async () => {
    const dry = async (args: string[], review?: object) => {
      const config = path.join(repo, '.agents/config.json');
      if (review) {
        mkdirSync(path.dirname(config), { recursive: true });
        writeFileSync(config, JSON.stringify({ deliver: { review } }));
      }
      try {
        return await loop(
          { items: [{ id: 310, title: '[PBI] feat: dry' }] },
          { args: ['--dry-run', ...args] },
        );
      } finally {
        rmSync(path.dirname(config), { recursive: true, force: true });
      }
    };
    expect((await dry([])).stdout).toMatch(/^review: claude \(claude .*--model opus /m);
    expect((await dry(['--model', 'claude-opus-5-5'])).stdout).toMatch(
      /^review: claude .*--model sonnet /m,
    );
    const config = { harness: 'copilot', model: 'gpt-x', effort: 'high', rounds: 3 };
    const fromConfig = await dry([], config);
    expect(fromConfig.stdout).toMatch(
      /^review: copilot \(copilot .*--model gpt-x --reasoning-effort high /m,
    );
    expect(fromConfig.stdout).toContain('deliver.review.rounds ignored');
    const flags = await dry(['--review-harness', 'claude', '--review-model', 'haiku'], {
      harness: 'copilot',
      model: 'gpt-x',
    });
    expect(flags.stdout).toMatch(/^review: claude .*--model haiku /m);
    const wrong = await dry(['--review-harness', 'codex']);
    expect(wrong.status).toBe(64);
    expect(wrong.stderr).toContain('unknown review harness "codex"');
  });
});

describe('parseVerdict', () => {
  const finding = { severity: 'blocking', file: 'a.ts', summary: 'x' };

  it.each([
    ['approve', { verdict: 'approve', findings: [], unmet: [] }],
    ['changes with a finding', { verdict: 'changes', findings: [finding], unmet: [] }],
    ['changes with an unmet criterion', { verdict: 'changes', findings: [], unmet: ['c'] }],
  ])('accepts %s', (_name, value) => {
    expect(parseVerdict(JSON.stringify(value))).toEqual(value);
  });

  it.each([
    ['no JSON', 'approve'],
    ['no object', '[]'],
    ['no lists', '{"verdict":"approve"}'],
    ['approve with a finding', { verdict: 'approve', findings: [finding], unmet: [] }],
    ['changes without a reason', { verdict: 'changes', findings: [], unmet: [] }],
    [
      'another severity',
      { verdict: 'changes', findings: [{ ...finding, severity: 'note' }], unmet: [] },
    ],
    ['an empty file', { verdict: 'changes', findings: [{ ...finding, file: '' }], unmet: [] }],
    ['an unmet criterion that is no text', { verdict: 'changes', findings: [], unmet: [1] }],
  ])('rejects %s', (_name, value) => {
    expect(parseVerdict(typeof value === 'string' ? value : JSON.stringify(value))).toBeUndefined();
  });

  it('deliver starts no review of its own', () => {
    const text = readFileSync(path.join(skill, 'SKILL.md'), 'utf8');
    expect(text).not.toMatch(/subagent with a fresh context/);
    expect(text).toContain('--review-file');
  });
});
