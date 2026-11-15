import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #608: an existing PR of the own branch is repaired (Repair-PullRequest.ps1)
const SKILL = path.resolve(__dirname, '../../../skills/delivery/deliver');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe('deliver repair docs (#608)', () => {
  const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  it('step 2 repairs the PR, then continues with step 7', () => {
    expect(skill).toContain('Repair-PullRequest.ps1 -Pr <pr> -Issue <nr>');
    expect(skill).toContain('references/repair.md');
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
    const ref = fs.readFileSync(path.join(SKILL, 'references/repair.md'), 'utf8');
    expect(ref).toContain('needs-decision');
    expect(ref).toContain('gh pr edit <n> --base');
  });
});

describe.skipIf(!hasPwsh || process.platform === 'win32')('Repair-PullRequest.ps1 (#608)', () => {
  let dir: string;
  let worker: PwshWorker;
  beforeAll(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'repair-')));
    worker = new PwshWorker(path.join(SKILL, 'scripts/Repair-PullRequest.ps1'));
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const run = async (
    name: string,
    pr: { head?: string; base?: string; title?: string; body?: string | null; fork?: boolean },
    editFails = false,
  ) => {
    const d = path.join(dir, name);
    const prJson = {
      head: {
        ref: pr.head ?? 'feat/7-thing',
        repo: { full_name: pr.fork ? 'someone/app' : 'acme/app' },
      },
      base: { ref: pr.base ?? 'main', repo: { full_name: 'acme/app' } },
      title: pr.title ?? 'feat/7-thing',
      body: pr.body ?? null,
    };
    const gh = createFakeGh(
      d,
      `(call) => {
        const a = call.args;
        if (a[0] === 'api' && /pulls\\/5$/.test(a[1])) return { rest: ${JSON.stringify(prJson)} };
        if (a[0] === 'api' && /issues\\/7$/.test(a[1])) return { rest: { title: '[PBI] feat(x): add the thing' } };
        if (a[0] === 'pr' && a[1] === 'edit') { if (${editFails}) throw new Error('classifier refused'); return { rest: '' }; }
        throw new Error('unexpected gh ' + a.join(' '));
      }`,
    );
    const r = await worker.run(['-Pr', '5', '-Issue', '7'], { cwd: dir, env: gh.env() });
    const edits = gh.calls().filter((c) => c.args[0] === 'pr');
    return {
      status: r.status,
      out: JSON.parse(r.stdout),
      edits: edits.map((c) => c.args),
      writes: gh.calls().filter((c) => c.args.includes('PATCH')),
    };
  };

  it('feat branch on main with branch-name title and empty body: all three fixed by one gh pr edit', async () => {
    const r = await run('main-feat', {});
    expect(r.status).toBe(0);
    expect(r.out.changed).toEqual(['base', 'title', 'body']);
    expect(r.edits).toHaveLength(1);
    expect(r.edits[0]).toEqual([
      'pr',
      'edit',
      '5',
      '--base',
      'release/next',
      '--title',
      'feat(x): add the thing (#7)',
      '--body',
      'Closes #7',
    ]);
    expect(r.writes).toEqual([]);
  });

  it('fix branch on main is a hotfix: base unchanged', async () => {
    const r = await run('hotfix', {
      head: 'fix/7-bug',
      base: 'main',
      title: 'fix: broken (#7)',
      body: 'Closes #7',
    });
    expect(r.out.changed).toEqual([]);
    expect(r.edits).toEqual([]);
  });

  it('existing body is preserved, Closes line appended; release/<x.y> base stays', async () => {
    const r = await run('body', { base: 'release/1.2', title: 'feat: a (#7)', body: 'My text' });
    expect(r.out.changed).toEqual(['body']);
    expect(r.edits[0]).toEqual(['pr', 'edit', '5', '--body', 'My text\n\nCloses #7']);
  });

  it('correct PR: changed empty, no write call', async () => {
    const r = await run('ok', {
      base: 'release/next',
      title: 'feat: a (#7)',
      body: 'x\n\nCloses #7',
    });
    expect(r.status).toBe(0);
    expect(r.out.changed).toEqual([]);
    expect(r.edits).toEqual([]);
  });

  it('PR from a foreign head repository is never modified (exit 3)', async () => {
    const r = await run('fork', { fork: true });
    expect(r.status).toBe(3);
    expect(r.out.foreign).toBe(true);
    expect(r.out.changed).toEqual([]);
    expect(r.edits).toEqual([]);
  });

  it('failed gh pr edit: exit 1 with the error and the exact command', async () => {
    const r = await run('fails', {}, true);
    expect(r.status).toBe(1);
    expect(r.out.error).toContain('classifier refused');
    expect(r.out.command).toBe(
      "gh pr edit 5 --base release/next --title 'feat(x): add the thing (#7)' --body 'Closes #7'",
    );
  });
});
