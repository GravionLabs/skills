import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createFakeGh } from '../../helpers/fake-gh';

const retro = path.resolve(__dirname, '../../../skills/delivery/retro');
const script = path.join(retro, 'scripts/file-drafts.mts');
const url = 'https://github.com/o/r/issues/60#issuecomment-1';

const item = (tick: string, head: string, draft: string) =>
  `- [${tick}] ${head}\n  <details>\n  <summary>Draft</summary>\n\n${draft.replace(/^/gm, '  ')}\n\n  </details>\n`;
const lesson = (id: string, scope: string) =>
  `\`\`\`markdown\n---\nid: ${id}\nscope: [${scope}]\nevidence: PR #12\nstatus: proposed\nversion: 1\ncreated: 2026-11-01\n---\n\nStore dates as UTC.\n\`\`\``;
const comment = (...items: string[]) =>
  `<!-- retro: M001 -->\nmetrics\n\n## Drafts\n\n${items.join('\n')}`;

// the fake gh is a POSIX shell wrapper
describe.skipIf(process.platform === 'win32')('retro file: file-drafts.mts (fake gh)', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'retro-file-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const setup = (body: string, association = 'MEMBER') => {
    const store = path.join(dir, 'body.md');
    writeFileSync(store, body);
    const fake = createFakeGh(
      dir,
      `(call) => {
        const a = call.args;
        const store = ${JSON.stringify(store)};
        const text = a.join(' ');
        if (a.includes('PATCH')) {
          fs.copyFileSync(a.find((x) => x.startsWith('body=@')).slice(6), store);
          return { rest: 'url' };
        }
        if (text.includes('/comments/1')) return { rest: {
          body: fs.readFileSync(store, 'utf8'), author_association: ${JSON.stringify(association)},
          user: { type: 'User' }, issue_url: 'https://api.github.com/repos/o/r/issues/60' } };
        if (text.includes('/labels/retro')) throw new Error('gh: Not Found (HTTP 404)');
        if (a.includes('POST')) return { rest: {} };
        return { rest: { title: '[Feature] f', labels: [] } };
      }`,
    );
    const run = (...args: string[]) =>
      spawnSync('node', [script, ...args], { cwd: dir, encoding: 'utf8', env: fake.env() });
    return {
      run,
      list: () => {
        const ran = run('list', url);
        expect(ran.stderr).toBe('');
        return JSON.parse(ran.stdout);
      },
      body: () => readFileSync(store, 'utf8'),
      writes: () => fake.calls().filter((c) => c.args.includes('-X')),
    };
  };

  it('lists two ticked of three, creates the label and files nothing on a rerun', () => {
    const fake = setup(
      comment(
        item('x', 'PBI: feat: one', '## Overview\n\nDo one.'),
        item(' ', 'PBI: feat: two', '## Overview\n\nDo two.'),
        item('X', 'Lesson: utc-dates', lesson('utc-dates', 'repo')),
      ).replace(/\n/g, '\r\n'),
    );
    const first = fake.list();
    expect(first.pbis).toMatchObject([
      { title: 'feat: one', repo: 'o/r', draft: '## Overview\n\nDo one.' },
    ]);
    expect(first.lessons).toMatchObject([{ id: 'utc-dates', repo: 'o/r' }]);
    expect(first.lessons[0].content).toContain('\nstatus: approved\n');
    expect(first).toMatchObject({ feature: 60, invalid: [], unticked: 1, filed: 0 });
    expect(fake.writes()[0]?.args).toContain('name=retro');

    const before = fake.body();
    expect(fake.run('mark', url, '--item', first.pbis[0].key, '--filed', '#71').status).toBe(0);
    expect(fake.run('mark', url, '--item', first.lessons[0].key, '--filed', 'PR #72').status).toBe(
      0,
    );
    expect(fake.body()).toBe(
      before
        .replace('PBI: feat: one', 'PBI: feat: one filed: #71')
        .replace('Lesson: utc-dates', 'Lesson: utc-dates filed: PR #72'),
    );
    const writes = fake.writes().length;
    expect(fake.list()).toMatchObject({ pbis: [], lessons: [], unticked: 1, filed: 2 });
    const again = fake.run('mark', url, '--item', first.pbis[0].key, '--filed', '#73');
    expect(again.stderr).toContain('already has a filed: note');
    expect(fake.writes()).toHaveLength(writes);
  });

  it('reports a ticked lesson with an invalid scope and does not file it', () => {
    const fake = setup(
      comment(
        item('x', 'Lesson: bad', lesson('bad', 'team:x')),
        item('x', 'Lesson: good', lesson('good', 'role:review')),
      ),
    );
    const out = fake.list();
    expect(out.lessons).toMatchObject([{ id: 'good' }]);
    expect(out.invalid).toEqual([
      { kind: 'Lesson', title: 'bad', reason: expect.stringContaining('invalid scope') },
    ]);
    expect(fake.writes()).toEqual([]);
  });

  it.each([
    ['an author without write access', comment(), 'NONE', 'write access'],
    ['a comment without the marker', '## Drafts\n', 'OWNER', 'not a retro comment'],
  ])('refuses %s', (_, body, association, message) => {
    const ran = setup(body, association).run('list', url);
    expect(ran.status).toBe(1);
    expect(ran.stderr).toContain(message);
  });
});

describe('retro file instructions', () => {
  const read = (file: string) => readFileSync(path.join(retro, file), 'utf8');

  it('has the mode in SKILL.md and help.md and stays user-invoked', () => {
    expect(read('SKILL.md')).toContain('`retro file <comment url>`');
    expect(read('SKILL.md')).toContain('references/file.md');
    expect(read('SKILL.md')).toContain('disable-model-invocation: true');
    expect(read('references/help.md')).toContain('/retro file <comment url>');
  });

  it('checks the lesson PR before the push and notes what was filed', () => {
    const ref = read('references/file.md');
    expect(ref).toContain('Before the push run `Get-Lessons.ps1 -Check`');
    expect(ref).toContain('--filed "#<nr>"');
    expect(ref).toContain('--filed "PR #<nr>"');
    expect(ref).toContain('labels `pbi` and `retro`');
  });
});
