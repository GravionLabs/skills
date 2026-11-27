import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createFakeGh } from '../../helpers/fake-gh';

const retro = path.resolve(__dirname, '../../../skills/delivery/retro');

type Output = {
  repositories: { repo: string; line: string; retros: { milestone: string; url: string }[] }[];
  notes: { url: string; body: string }[];
};

// the fake gh is a POSIX shell wrapper
describe.skipIf(process.platform === 'win32')('retro --objective (fake gh)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'retro-objective-'));
  });
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const run = (script: string, args: string[]) => {
    const store = path.join(dir, 'posted.json');
    const fake = createFakeGh(
      dir,
      `(call) => {
        const a = call.args;
        const store = ${JSON.stringify(store)};
        const posted = fs.existsSync(store) ? JSON.parse(fs.readFileSync(store, 'utf8')) : [];
        const text = a.join(' ');
        if (a[1] === 'graphql') return { rest: [{ data: { repository: { issueOrPullRequest: {
          comments: { nodes: posted } } } } }] };
        const file = a.find((x) => x.startsWith('body=@'));
        if (file) {
          const body = fs.readFileSync(file.slice(6), 'utf8');
          const url = 'https://github.com/o/a/issues/1#issuecomment-1';
          const route = a.find((x) => x.startsWith('repos/'));
          fs.writeFileSync(store, JSON.stringify([{ url, body, viewerDidAuthor: true, route,
            method: a[a.indexOf('-X') + 1] }]));
          return { rest: url };
        }
        const issue = (repo, number, kind) => ({ number, title: '[' + kind + '] t', labels: [],
          repository_url: 'https://api.github.com/repos/' + repo,
          html_url: 'https://github.com/' + repo + '/issues/' + number });
        const note = (id, body, at, association = 'OWNER', type = 'User') => ({ body,
          html_url: 'u/' + id, updated_at: at, author_association: association, user: { type } });
        const route = a.at(-1).split('?')[0];
        const data = {
          'repos/o/a/issues/1': { title: '[Objective] x', html_url: 'u/objective',
            body: '## Affected repos\\n\\n- o/a\\n- \`o/c\`\\n- other/z\\n\\n## Requires\\n- o/no@M1' },
          'repos/o/a/issues/1/sub_issues': [issue('o/a', 2, 'Feature'), issue('o/b', 3, 'Epic')],
          'repos/o/b/issues/3/sub_issues': [issue('o/b', 4, 'Feature')],
          'repos/o/a/issues/2/comments': [
            note(1, '<!-- retro: M001 -->\\nloop review: 1 changes requested, 2 escaped', '1'),
            note(2, '<!-- retro: M002 -->\\nloop review: 0 changes requested, 3 escaped', '1', 'NONE', 'Bot'),
            note(3, '<!-- retro: M009 -->\\nforged', '1', 'NONE'),
          ],
          'repos/o/b/issues/4/comments': [
            note(4, '<!-- retro: M001 -->\\nloop review: n/a changes requested, 1 escaped', '1'),
          ],
          'repos/o/a/issues/1/comments': [
            note(5, 'observation', '1'),
            note(6, '<!-- retro: objective -->\\nold', '1'),
            note(7, 'stranger', '1', 'NONE'),
          ],
        };
        if (!(route in data)) throw new Error('unexpected ' + text);
        return { rest: a.includes('--slurp') ? [data[route]] : data[route] };
      }`,
    );
    const ran = spawnSync('node', [path.join(retro, 'scripts', script), ...args], {
      cwd: dir,
      encoding: 'utf8',
      env: fake.env(),
    });
    return {
      ran,
      posted: () => (existsSync(store) ? JSON.parse(readFileSync(store, 'utf8')) : []),
    };
  };

  it('reads the retros per repository and reports one without as "no retro"', () => {
    const { ran } = run('objective.mts', ['--objective', 'o/a#1']);
    expect(ran.stderr).toBe('');
    const out = JSON.parse(ran.stdout) as Output;
    expect(out.repositories.map((r) => r.line)).toEqual([
      'o/a: M001, M002; loop review: 1 changes requested, 5 escaped',
      'o/b: M001; loop review: n/a changes requested, 1 escaped',
      'o/c: no retro',
    ]);
    expect(out.repositories[0]?.retros.map((r) => r.url)).toEqual(['u/1', 'u/2']);
    expect(out.notes).toEqual([{ url: 'u/5', body: 'observation' }]);
  });

  it('posts one comment on the Objective and edits it on a rerun', () => {
    writeFileSync(path.join(dir, 'report.md'), 'report\n');
    const args = ['--objective', 'o/a#1', '--file', path.join(dir, 'report.md')];
    const first = run('post-comment.mts', args);
    expect(first.ran.status).toBe(0);
    expect(first.posted()[0]).toMatchObject({
      method: 'POST',
      route: 'repos/o/a/issues/1/comments',
      body: '<!-- retro: objective -->\nreport\n',
    });
    expect(run('post-comment.mts', args).posted()[0]).toMatchObject({
      method: 'PATCH',
      route: 'repos/o/a/issues/comments/1',
    });
  });

  it.each(['1', 'o/a', '../a#1'])('refuses the objective %s', (value) => {
    const { ran } = run('objective.mts', ['--objective', value]);
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain('<owner>/<repo>#<nr>');
  });
});

describe('retro --objective instructions', () => {
  const read = (file: string) => readFileSync(path.join(retro, file), 'utf8');

  it('names the input and ranks cross-repository candidates first', () => {
    expect(read('SKILL.md')).toContain('--objective <owner>/<repo>#<nr>');
    expect(read('SKILL.md')).toContain('references/objective.md');
    expect(read('references/help.md')).toContain('--objective <owner>/<repo>#<nr>');
    const ref = read('references/objective.md');
    expect(ref).toContain('First the candidates that hold for **two or more repositories**');
    expect(ref).toContain('marked `[<repo>, <repo>]`');
    expect(ref).toContain('names `GravionLabs/skills`');
  });
});
