// merged-meanwhile: the commits and files merged on the base since the fork point of a workspace (#1165).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { fixture, git, loop, repo, root, skill } from './deliver/run-loop';

const script = path.join(skill, 'scripts/gates/merged-meanwhile.mts');
const { mergedMeanwhile } = (await import(
  script
)) as typeof import('../../../skills/delivery/deliver/scripts/gates/merged-meanwhile.mts');
const { runGate } = (await import(
  path.join(skill, 'scripts/gates/result.mts')
)) as typeof import('../../../skills/delivery/deliver/scripts/gates/result.mts');

fixture();

/** A worktree of the repository, detached at the base as it is now. */
function workspace(name: string): string {
  const dir = path.join(root, name);
  git(repo, 'fetch', '--quiet', 'origin');
  git(repo, 'worktree', 'add', '--quiet', '--detach', dir, 'origin/main');
  return dir;
}
/** Others merge one commit per file into main on origin; returns their shas, newest first. */
function foreignMerge(...files: string[]): string[] {
  const other = workspace(`other-${files[0]}`);
  const shas = files.map((file) => {
    writeFileSync(path.join(other, file), `${file}\n`);
    git(other, 'add', file);
    git(other, 'commit', '--quiet', '-m', `feat: add ${file}`);
    return git(other, 'rev-parse', 'HEAD').trim();
  });
  git(other, 'push', '--quiet', 'origin', 'HEAD:main');
  git(repo, 'worktree', 'remove', '--force', other);
  return shas.reverse();
}
const fileOf = (run: string, issue: number) =>
  path.join(repo, '.git', 'deliver', run, `${issue}.merged-meanwhile.md`);

describe('merged-meanwhile', () => {
  it('passes with empty lists and drops an earlier file when nothing was merged', () => {
    const dir = workspace('quiet');
    const input = { workspace: dir, base: 'main', issue: 1, run: 'r1' };
    foreignMerge('quiet.txt');
    expect(mergedMeanwhile(input).evidence.file).toBe(fileOf('r1', 1));
    git(dir, 'merge', '--quiet', '--ff-only', 'origin/main');
    expect(mergedMeanwhile(input)).toMatchObject({
      result: 'pass',
      evidence: { commits: [], files: [] },
    });
    expect(mergedMeanwhile(input).evidence).not.toHaveProperty('file');
    expect(existsSync(fileOf('r1', 1))).toBe(false);
  });

  it('lists two merged commits and their files, not the own commit, in a file outside the worktree', async () => {
    const dir = workspace('behind');
    writeFileSync(path.join(dir, 'own.txt'), 'own\n');
    git(dir, 'add', 'own.txt');
    git(dir, 'commit', '--quiet', '-m', 'feat: own work');
    const [second, first] = foreignMerge('one.txt', 'two.txt');

    // the CLI, with the run of the session
    const out = await runGate(script, [dir, '--base', 'main', '--issue', '2'], {
      env: { ...process.env, DELIVER_RUN: 'r2' },
    });

    expect(out).toMatchObject({
      result: 'pass',
      evidence: {
        commits: [
          { sha: second, subject: 'feat: add two.txt' },
          { sha: first, subject: 'feat: add one.txt' },
        ],
        files: ['one.txt', 'two.txt'],
      },
    });
    // git names the repository by its real path, a temp directory may be a symlink
    expect(String(out.evidence.file)).toMatch(/[\\/]\.git[\\/]deliver[\\/]r2[\\/]2\.merged/);
    const text = readFileSync(String(out.evidence.file), 'utf8');
    expect(text).toContain(`- ${first!.slice(0, 12)} feat: add one.txt`);
    expect(text).toContain('- two.txt');
    expect(text).not.toContain('own');
    // nothing for a session to commit
    expect(git(dir, 'status', '--porcelain')).toBe('');
  });

  it.each([
    ['a path that is no git worktree', { workspace: '' }, /not a git worktree/],
    ['a bare repository', { workspace: 'origin.git' }, /not a git worktree/],
    ['a base that is no branch name', { base: 'ma*n' }, /not a branch name/],
    ['a run that leaves the folder', { run: '..' }, /name the run/],
    ['no issue number', { issue: Number.NaN }, /issue/],
  ])('is usage for %s', (_name, wrong, reason) => {
    const input = { workspace: 'repo', base: 'main', issue: 3, run: 'r3', ...wrong };
    const out = mergedMeanwhile({ ...input, workspace: path.join(root, input.workspace) });
    expect(out.result).toBe('usage');
    expect(out.reason).toMatch(reason);
  });

  it('is usage on the command line without a base', async () => {
    const out = await runGate(script, [repo, '--issue', '3']);
    expect(out.result).toBe('usage');
  });

  it('is retry when the fetch fails', () => {
    const out = mergedMeanwhile({ workspace: repo, base: 'gone', issue: 4, run: 'r4' });
    expect(out.result).toBe('retry');
    expect(out.reason).toMatch(/fetch of origin\/gone failed/);
  });
});

describe('deliver loop: merged-meanwhile', () => {
  it('names the file in the prompt of an implementer session whose base moved', async () => {
    // the worktree an earlier run left behind
    workspace(`${path.basename(repo)}-wt-51`);
    foreignMerge('meanwhile.txt');

    const out = await loop({ items: [{ id: 51, title: '[PBI] feat: item 51' }] });

    expect(out.status).toBe(0);
    const file = /--merged-meanwhile-file (\S+)/.exec(out.sessions[0]?.prompt ?? '')?.[1];
    expect(file).toMatch(/51\.merged-meanwhile\.md$/);
    expect(readFileSync(file!, 'utf8')).toContain('- meanwhile.txt');
    expect(out.reviews[0]?.prompt).not.toContain('--merged-meanwhile-file');
  });
});
