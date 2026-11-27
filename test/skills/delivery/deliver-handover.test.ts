// deliver: the comments of the loop on the issue (#1015): hand-over reason and review summary, posted once.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handoverNote, reasonKind } from '../../../skills/delivery/deliver/scripts/handover.mts';
import { create } from '../../../skills/delivery/deliver/scripts/tracker/github.mts';
import { createFakeGh } from '../../helpers/fake-gh';
import { fixture, loop, skill } from './deliver/run-loop';

fixture();

describe('handoverNote', () => {
  it.each([
    ['changes protected paths (.github/x.yml)', 'protected-paths'],
    ['conflict repaired, changes protected paths (.claude/a)', 'protected-paths'],
    ['more than one open pull request (a, b)', 'more-pulls'],
    ['red: ci', 'red-checks'],
    ['needs-decision', 'needs-decision'],
    ['session timeout', 'session-timeout'],
    ['needs-decision: review still asks for changes after 2 fix rounds (x)', 'changes-remain'],
    ['session failed (exit 1) (session: blocked a conflict)', 'session-failed'],
    ['something else', 'other'],
  ])('names %s %s', (reason, kind) => {
    expect(reasonKind(reason)).toBe(kind);
  });

  it('keeps text of an agent inside one code span', () => {
    const { body } = handoverNote({
      reason: 'needs-decision: `@someone`\n<!-- x -->',
      planned: false,
      head: 'none',
      urls: [],
    });
    expect(body).toContain('- Reason: `needs-decision:  @someone <!-- x -->`');
    expect(body).toContain('- Pull request: none');
  });
});

describe('deliver loop: issue comments', () => {
  const run = (id: number, extra: Parameters<typeof loop>[0] | object) =>
    loop({ items: [{ id, title: '[PBI] feat: told' }], ...extra });

  it('summarizes every review round without the findings', async () => {
    const out = await run(701, { verdicts: ['changes', 'approve'] });
    expect(out.comments.map((c) => c.marker)).toEqual([
      '<!-- deliver-review-summary: 1 changes abc123 -->',
      '<!-- deliver-review-summary: 2 approve abc123 -->',
    ]);
    const first = out.comments[0]?.body;
    expect(first).toContain('- Blocking findings: 1');
    expect(first).toContain('https://example.test/pull/801');
    expect(first).not.toContain('broken');
  });

  it('tells the reason, the pull request and the next step of a hand-over', async () => {
    const out = await run(702, { files: ['.claude/settings.json'] });
    expect(out.comments).toHaveLength(1);
    expect(out.comments[0]?.marker).toBe('<!-- deliver-handover: protected-paths abc123 -->');
    expect(out.comments[0]?.body).toContain('changes protected paths (.claude/settings.json)');
    expect(out.comments[0]?.body).toContain('https://example.test/pull/802');
    expect(out.comments[0]?.body).toContain('merge it yourself');
  });

  it('tells why an issue without a pull request is set aside', async () => {
    const out = await run(703, { noPull: true });
    expect(out.comments.map((c) => c.marker)).toEqual([
      '<!-- deliver-handover: session-failed none -->',
    ]);
  });

  it('points a person at a merged pull request of high risk', async () => {
    const out = await loop(
      { items: [{ id: 704, title: '[PBI] feat: told' }], risks: { 704: 'high' } },
      { args: ['--merge-risk', 'high'] },
    );
    expect(out.comments.at(-1)?.marker).toBe('<!-- deliver-handover: high-risk abc123 -->');
  });
});

describe('GitHub tracker: commentOnce (fake gh)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'deliver-comment-'));
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    rmSync(dir, { recursive: true, force: true });
  });

  const marker = '<!-- deliver-handover: red-checks abc -->';
  const post = (comments: { body: string; user: { login: string } }[]) => {
    const file = path.join(dir, 'comments.json');
    writeFileSync(file, JSON.stringify(comments));
    // the fake keeps what is posted: a second run sees it
    const fake = createFakeGh(
      dir,
      `(call) => {
        const a = call.args;
        if (a[0] === 'repo') return { rest: 'o/r' };
        if (a[1] === 'user') return { rest: 'loop-user' };
        const all = JSON.parse(fs.readFileSync(${JSON.stringify(file)}, 'utf8'));
        if (a.includes('POST')) {
          all.push({ body: a.at(-1).slice('body='.length), user: { login: 'loop-user' } });
          fs.writeFileSync(${JSON.stringify(file)}, JSON.stringify(all));
          return { rest: {} };
        }
        return { rest: [all] };
      }`,
    );
    for (const [k, v] of Object.entries(fake.env())) if (v !== undefined) vi.stubEnv(k, v);
    const item = { id: 7, title: '', url: '', labels: [], body: '' };
    // two trackers: the second is a later run that resumes
    for (let run = 0; run < 2; run++)
      create({
        cwd: dir,
        base: 'main',
        selection: { issues: [] },
        trustAuthors: false,
      }).commentOnce(item, marker, `${marker}\ntext`);
    return fake.calls().filter((c) => c.args.includes('POST'));
  };

  it('posts a marker once, also on resume', () => {
    const posts = post([]);
    expect(posts).toHaveLength(1);
    expect(posts[0]?.args).toContain('repos/o/r/issues/7/comments');
  });

  it('ignores the marker of another login', () => {
    expect(post([{ body: marker, user: { login: 'someone' } }])).toHaveLength(1);
  });

  it('posts again for another head', () => {
    const other = marker.replace('abc', 'old');
    expect(post([{ body: other, user: { login: 'loop-user' } }])).toHaveLength(1);
  });
});

describe('deliver skill: feature pull requests are transport', () => {
  const text = readFileSync(path.join(skill, 'SKILL.md'), 'utf8');

  it('states the rule and creates the pull request without review notes or reviewer', () => {
    expect(text).toContain('Feature pull requests are transport');
    expect(text).toContain('pass no `review_notes`');
    expect(text).toContain('pass no `add_reviewer`');
  });
});
