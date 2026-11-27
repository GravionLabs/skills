import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createFakeGh } from '../../helpers/fake-gh';

const retro = path.resolve(__dirname, '../../../skills/delivery/retro');
const script = path.join(retro, 'scripts/run-metrics.mts');
const url = (kind: string, nr: number) => `https://github.com/o/r/${kind}/${nr}`;

const pull = (number: number, issue: number, milestone: string | null = null) => ({
  number,
  url: url('pull', number),
  title: `feat: ${issue}`,
  headRefName: `feat/${issue}-x`,
  body: `Closes #${issue}`,
  mergedAt: '2026-11-01T12:00:00Z',
  milestone: milestone && { title: milestone },
});
const ticket = (number: number, title: string, body: string, createdAt: string) => ({
  number,
  url: url('issues', number),
  title,
  body,
  createdAt,
  labels: [],
});
const comment = (body: string, minute: number, authorAssociation = 'MEMBER') => ({
  body,
  authorAssociation,
  createdAt: `2026-11-01T10:${String(minute).padStart(2, '0')}:00Z`,
  url: `${url('pull', 21)}#issuecomment-${minute}`,
});
// the comment of deliver-review and the mark the loop writes after it
const loopRound = [
  comment('## Review of #11: changes', 1),
  comment('<!-- deliver-review: changes abc -->\nrecorded', 2),
  comment('## Review of #11: approve', 3),
  comment('<!-- deliver-review: approve def -->\nrecorded', 4),
];

type World = { views?: object; tickets?: object[] };

describe('run-metrics.mts --milestone: escaped findings', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'retro-escaped-'));
  let count = 0;
  const run = (world: World = {}, milestone = 'M7') => {
    const dir = path.join(root, String(count++));
    fs.mkdirSync(dir);
    const data = {
      title: 'M7 (1.2.0)',
      pulls: [pull(21, 11), pull(22, 12), pull(90, 80)],
      views: { 21: { comments: loopRound, reviews: [] }, ...world.views },
      tickets: world.tickets ?? [],
    };
    const gh = createFakeGh(
      dir,
      `(call) => {
        const data = ${JSON.stringify(data)};
        const [a, b] = call.args;
        if (a === 'api') return { rest: [[{ title: 'M70' }, { title: data.title }]] };
        if (a === 'release') return { rest: [{ tagName: 'v1.2.0', publishedAt: '2026-11-10T00:00:00Z' }] };
        if (a === 'pr' && b === 'list') return { rest: data.pulls };
        if (a === 'pr') return { rest: data.views[call.args[2]] || { comments: [], reviews: [] } };
        if (call.args.includes('--milestone')) return { rest: [{ number: 12 }, { number: 11 }] };
        return { rest: data.tickets };
      }`,
    );
    const result = spawnSync(
      process.execPath,
      [script, '--milestone', milestone, '--root', path.join(dir, 'none')],
      { encoding: 'utf8', env: gh.env() },
    );
    return { ...result, calls: gh.calls() };
  };
  const review = (world?: World) => {
    const result = run(world);
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout).loopReview;
  };
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  describe('none escaped', () => {
    let result: ReturnType<typeof run>;
    beforeAll(() => {
      result = run();
    });

    it('counts the changes of the loop from its marks and no escaped finding', () => {
      expect(JSON.parse(result.stdout)).toMatchObject({
        milestone: 'M7 (1.2.0)',
        loopReview: { changesRequested: 1, escaped: 0, items: [] },
      });
    });

    it('reads only the pull requests of the milestone', () => {
      const viewed = result.calls.filter((c) => c.args[1] === 'view').map((c) => c.args[2]);
      expect(viewed).toEqual(['21', '22']);
    });
  });

  it.each([
    'Follow-up of #11',
    'found in #22',
    `Top fix of the audit: ${url('pull', 21)}`,
    'See o/r#12.',
  ])('counts a follow-up PBI created after the first merge (%s)', (body) => {
    const data = review({
      tickets: [ticket(30, '[PBI] fix: x', body, '2026-11-02T00:00:00Z')],
    });
    expect(data.items).toEqual([
      { source: 'follow-up', number: 30, url: url('issues', 30), title: '[PBI] fix: x' },
    ]);
    expect(data.escaped).toBe(1);
  });

  it('counts a human review and a review comment of another session', () => {
    const data = review({
      views: {
        21: {
          comments: [
            ...loopRound,
            comment('## Review gate (#1367): changes requested', 5),
            comment('## Review of #21: changes', 6, 'NONE'),
          ],
          reviews: [
            { state: 'CHANGES_REQUESTED', authorAssociation: 'OWNER' },
            { state: 'APPROVED', authorAssociation: 'OWNER' },
          ],
        },
        // before the approve mark of the loop: not the comment of a changes round
        22: {
          comments: [
            comment('Verdict:\n{ "verdict": "changes" }', 1),
            comment('<!-- deliver-review: approve abc -->', 2),
          ],
          reviews: [],
        },
      },
    });
    expect(data).toMatchObject({ changesRequested: 1, escaped: 3 });
    expect(data.items.map((i: { url: string }) => i.url)).toEqual([
      `${url('pull', 21)}#issuecomment-5`,
      url('pull', 21),
      `${url('pull', 21)}#issuecomment-1`,
    ]);
  });

  it.each(['Broken since v1.2.0.', 'Seen with M7', 'Regression of #11'])(
    'counts a Bug filed within 7 days of the release (%s)',
    (body) => {
      const data = review({
        tickets: [ticket(31, '[Bug] fix: y', body, '2026-11-12T00:00:00Z')],
      });
      expect(data.items).toMatchObject([{ source: 'after-release', number: 31 }]);
    },
  );

  it('counts nothing outside the milestone, its time or its kinds', () => {
    const after = '2026-11-12T00:00:00Z';
    const data = review({
      views: {
        90: { comments: [], reviews: [{ state: 'CHANGES_REQUESTED', authorAssociation: 'OWNER' }] },
      },
      tickets: [
        ticket(40, '[PBI] feat: a', 'Follow-up of #80 and #90, other/repo#11', after),
        ticket(41, '[PBI] feat: b', 'Parent Feature: #11\nBlocked by #12', after),
        ticket(42, '[PBI] feat: c', 'Follow-up of #11', '2026-10-01T00:00:00Z'),
        ticket(43, '[Feature] feat: d', 'Follow-up of #11', after),
        ticket(44, '[Bug] fix: e', 'Broken since 1.2.0', '2026-11-30T00:00:00Z'),
        ticket(45, '[Bug] fix: f', 'Broken since 11.2.0 and M70', after),
      ],
    });
    expect(data).toMatchObject({ escaped: 0, items: [] });
  });

  it('refuses an unknown milestone', () => {
    const result = run({}, 'M8');
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('run-metrics: no milestone "M8"');
  });

  it('shows the row, the links and the review candidate in the skill', () => {
    const read = (file: string) => fs.readFileSync(path.join(retro, file), 'utf8');
    const row = 'loop review: <x> changes requested, <y> escaped';
    expect(read('SKILL.md')).toContain(row);
    expect(read('SKILL.md')).toMatch(/`y > x`: a candidate in category review/);
    expect(read('references/categories.md')).toMatch(/`y > x`\)[^\n]*category 3/);
    const sources = read('references/metrics-sources.md');
    for (const source of ['`review`', '`follow-up`', '`after-release`']) {
      expect(sources).toContain(source);
    }
    expect(sources).toContain('gh pr view <pr> --json comments,reviews');
    expect(sources).toContain('gh release list');
  });
});
