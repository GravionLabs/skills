import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeGh } from '../../helpers/fake-gh';

const retro = path.resolve(__dirname, '../../../skills/delivery/retro');
const script = path.join(retro, 'scripts/post-comment.mts');

type Comment = { target: number; url: string; body: string; viewerDidAuthor: boolean };

// the fake gh is a POSIX shell wrapper
describe.skipIf(process.platform === 'win32')('retro --post: post-comment.mts (fake gh)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'retro-post-'));
    writeFileSync(path.join(dir, 'report.md'), 'metrics\n- [ ] PBI: x\n');
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  /** `parents`: issue number to the number of its Feature. The fake keeps the comments across runs. */
  const run = (parents: Record<number, number>, args: string[] = []) => {
    const store = path.join(dir, 'comments.json');
    const fake = createFakeGh(
      dir,
      `(call) => {
        const a = call.args;
        const store = ${JSON.stringify(store)};
        const all = fs.existsSync(store) ? JSON.parse(fs.readFileSync(store, 'utf8')) : [];
        const text = a.join(' ');
        if (a[0] === 'repo') return { rest: 'o/r' };
        if (a[0] === 'issue') return { rest: [{ number: 1 }, { number: 2 }, { number: 3 }] };
        if (text.includes('/milestones')) return { rest: [[{ title: 'M001 (1.2.0)' }]] };
        const parent = /issues\\/(\\d+)\\/parent/.exec(text);
        if (parent) {
          const nr = ${JSON.stringify(parents)}[parent[1]];
          if (!nr) throw new Error('gh: Not Found (HTTP 404)');
          return { rest: { number: nr, title: '[Feature] f', labels: [],
            repository_url: 'https://api.github.com/repos/o/r' } };
        }
        if (a[1] === 'graphql') {
          const target = Number(a.at(-1).split('=')[1]);
          return { rest: [{ data: { repository: { issueOrPullRequest: { comments: {
            nodes: all.filter((c) => c.target === target) } } } } }] };
        }
        const body = fs.readFileSync(a.find((x) => x.startsWith('body=@')).slice(6), 'utf8');
        let comment;
        if (a.includes('PATCH')) {
          comment = all.find((c) => c.url.endsWith('-' + /comments\\/(\\d+)/.exec(text)[1]));
          comment.body = body;
        } else {
          const target = Number(/issues\\/(\\d+)\\/comments/.exec(text)[1]);
          comment = { target, body, viewerDidAuthor: true,
            url: 'https://github.com/o/r/issues/' + target + '#issuecomment-' + (all.length + 1) };
          all.push(comment);
        }
        fs.writeFileSync(store, JSON.stringify(all));
        return { rest: comment.url };
      }`,
    );
    const result = path.join(dir, 'result.json');
    const ran = spawnSync(
      'node',
      [script, '--milestone', 'M001', '--file', path.join(dir, 'report.md'), ...args],
      { cwd: dir, encoding: 'utf8', env: { ...fake.env(), DELIVER_RETRO_FILE: result } },
    );
    return {
      ran,
      comments: (): Comment[] => (existsSync(store) ? JSON.parse(readFileSync(store, 'utf8')) : []),
      url: () => JSON.parse(readFileSync(result, 'utf8')).url as string,
    };
  };

  it('posts on the Feature with most issues and edits that comment on a rerun', () => {
    const first = run({ 1: 50, 2: 60, 3: 60 });
    expect(first.ran.status).toBe(0);
    expect(first.url()).toBe('https://github.com/o/r/issues/60#issuecomment-1');
    expect(first.comments()[0]?.body).toBe('<!-- retro: M001 -->\nmetrics\n- [ ] PBI: x\n');
    writeFileSync(path.join(dir, 'report.md'), 'second\n');
    const again = run({ 1: 50, 2: 60, 3: 60 });
    expect(again.url()).toBe(first.url());
    expect(again.comments()).toHaveLength(1);
    expect(again.comments()[0]?.body).toBe('<!-- retro: M001 -->\nsecond\n');
  });

  it("does not edit another login's comment with the marker", () => {
    writeFileSync(
      path.join(dir, 'comments.json'),
      JSON.stringify([
        {
          target: 9,
          url: 'u#issuecomment-7',
          body: '<!-- retro: M001 -->',
          viewerDidAuthor: false,
        },
      ]),
    );
    expect(run({}, ['--release-pr', 'https://github.com/o/r/pull/9']).comments()).toHaveLength(2);
  });

  it('fails without a Feature and without a release pull request', () => {
    const out = run({});
    expect(out.ran.status).toBe(1);
    expect(out.ran.stderr).toContain('--release-pr');
    expect(out.comments()).toEqual([]);
  });
});

describe('retro --post instructions', () => {
  const read = (file: string) => readFileSync(path.join(retro, file), 'utf8');

  it('loads references/post.md, which drafts a checklist and writes only the comment', () => {
    expect(read('SKILL.md')).toContain('references/post.md');
    const ref = read('references/post.md');
    expect(ref).toContain('- [ ] PBI: <title>');
    expect(ref).toContain('- [ ] Lesson: <id>');
    expect(ref).toContain('<details>');
    expect(ref).toContain('node scripts/post-comment.mts');
    expect(ref).toMatch(/Never create or edit an issue or pull request, never push/);
    expect(read('references/help.md')).toContain('--post');
  });
});
