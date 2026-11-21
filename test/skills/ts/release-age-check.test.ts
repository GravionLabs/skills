import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const script = path.resolve(
  __dirname,
  '../../../skills/ts/ts-pnpm-workflow/scripts/Test-ReleaseAge.ps1',
);

function run(args: string[]) {
  const r = spawnSync('pwsh', ['-NoProfile', '-File', script, ...args], { encoding: 'utf-8' });
  return { status: r.status, json: JSON.parse(r.stdout) };
}

function repo(parent: string, name: string, workspace?: string, lock = true) {
  const dir = path.join(parent, name);
  fs.mkdirSync(path.join(dir, '.git'), { recursive: true });
  if (lock) fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  if (workspace !== undefined) fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), workspace);
  return dir;
}

describe('Test-ReleaseAge.ps1 (#834)', () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relage-'));
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('fails with exit 1 when the key is missing', () => {
    const dir = repo(tmp, 'a', 'packages: []\n');
    const r = run(['-Repo', dir]);
    expect(r.status).toBe(1);
    expect(r.json).toMatchObject({ hasLockfile: true, minimumReleaseAge: null, ok: false });
  });

  it('fails when pnpm-workspace.yaml is missing', () => {
    expect(run(['-Repo', repo(tmp, 'a')]).status).toBe(1);
  });

  it('fails below 4320', () => {
    expect(run(['-Repo', repo(tmp, 'a', 'minimumReleaseAge: 60\n')]).status).toBe(1);
  });

  it('passes with 10080', () => {
    const r = run(['-Repo', repo(tmp, 'a', 'minimumReleaseAge: 10080\n')]);
    expect(r.status).toBe(0);
    expect(r.json).toMatchObject({ minimumReleaseAge: 10080, ok: true });
  });

  it('skips a repository without a lockfile', () => {
    const r = run(['-Repo', repo(tmp, 'a', undefined, false)]);
    expect(r.status).toBe(0);
    expect(r.json).toMatchObject({ hasLockfile: false, ok: null, skipped: true });
  });

  it('-Root reports each child repository and exits 1 when one is not ok', () => {
    repo(tmp, 'good', 'minimumReleaseAge: 10080\n');
    repo(tmp, 'bad', 'packages: []\n');
    repo(tmp, 'nolock', undefined, false);
    fs.mkdirSync(path.join(tmp, 'plain'));
    const r = run(['-Root', tmp]);
    expect(r.status).toBe(1);
    expect(
      r.json.map((x: { repo: string; ok: boolean | null }) => [path.basename(x.repo), x.ok]),
    ).toEqual([
      ['bad', false],
      ['good', true],
      ['nolock', null],
    ]);
  });

  it('-Root exits 0 when all pass', () => {
    repo(tmp, 'good', 'minimumReleaseAge: 10080\n');
    const r = run(['-Root', tmp]);
    expect(r.status).toBe(0);
    expect(r.json).toHaveLength(1);
  });
});
