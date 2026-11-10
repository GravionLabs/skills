import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const skillDir = path.join(root, 'skills/github/github-release');
const script = path.join(skillDir, 'scripts/Test-ReleaseVersion.ps1');

const env = { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd: string, ...a: string[]) => {
  const r = spawnSync(
    'git',
    ['-c', 'commit.gpgsign=false', '-c', 'user.name=t', '-c', 'user.email=t@t', ...a],
    { cwd, encoding: 'utf8', env },
  );
  if (r.status !== 0) throw new Error(`git ${a.join(' ')}: ${r.stderr}`);
};
const run = (cwd: string, tag: string) => {
  const r = spawnSync('pwsh', ['-NoProfile', '-File', script, '-Tag', tag], {
    cwd,
    encoding: 'utf8',
    env,
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
};

let repo: string;
const commit = (msg: string) => git(repo, 'commit', '-q', '--allow-empty', '-m', msg);

beforeAll(() => {
  repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'rv-')));
  git(repo, 'init', '-q', '-b', 'main');
  commit('chore: init');
  git(repo, 'tag', 'v0.4.0');
  commit('fix: a bug');
  commit('feat: a feature');
  git(repo, 'tag', 'v0.5.0');
  commit('feat: next feature');
  git(repo, 'tag', 'v0.6.0');
  commit('fix: only fix');
  git(repo, 'tag', 'v0.6.1');
  commit('feat!: breaking');
  git(repo, 'tag', 'v1.0.0');
  commit('fix: late fix');
  commit('feat: wrong tag');
  git(repo, 'tag', 'v1.0.1');
});
afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

describe('Test-ReleaseVersion.ps1', () => {
  it('feat since the previous tag expects a minor and matches', () => {
    const j = JSON.parse(run(repo, 'v0.6.0').out);
    expect(j).toMatchObject({ previous: 'v0.5.0', expected: '0.6.0', match: true, bump: 'minor' });
    expect(j.deciding).toHaveLength(1);
    expect(j.deciding[0]).toContain('feat: next feature');
  });

  it('only fixes expect a patch', () => {
    expect(JSON.parse(run(repo, 'v0.6.1').out)).toMatchObject({ expected: '0.6.1', match: true });
  });

  it('a breaking commit expects a major', () => {
    expect(JSON.parse(run(repo, 'v1.0.0').out)).toMatchObject({ expected: '1.0.0', bump: 'major' });
  });

  it('a feat released as a patch is a mismatch and names the deciding commit', () => {
    const j = JSON.parse(run(repo, 'v1.0.1').out);
    expect(j).toMatchObject({ expected: '1.1.0', match: false, bump: 'minor' });
    expect(j.deciding.join('\n')).toContain('feat: wrong tag');
  });

  it('the first tag has nothing to compare and matches', () => {
    expect(JSON.parse(run(repo, 'v0.4.0').out)).toMatchObject({ previous: null, match: true });
  });

  it('rejects a tag that is not v<x.y.z>', () => {
    const r = run(repo, 'release-1');
    expect(r.status).toBe(1);
    expect(r.err).toContain('invalid tag');
  });
});

describe('github-release finish closes the milestone (docs)', () => {
  const read = (p: string) => fs.readFileSync(path.join(skillDir, p), 'utf8');
  const skill = read('SKILL.md');
  const ref = read('references/close-milestone.md');

  it('SKILL.md stays within 100 lines and points to the reference and the script', () => {
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
    expect(skill).toContain('references/close-milestone.md');
    expect(skill).toContain('Test-ReleaseVersion.ps1');
    expect(skill).toContain('--yes');
  });

  it('the reference covers version check, leftovers, create before close, report and fallback', () => {
    expect(ref).toMatch(/match` false[\s\S]*Nothing is renamed/);
    expect(ref).toContain('Released in v<x.y.z>');
    expect(ref.indexOf('-Mode create')).toBeLessThan(ref.indexOf('-Mode close'));
    expect(ref).toMatch(/ready issues/);
    expect(ref).toContain('/github-release cut');
    expect(ref).toMatch(/otherwise stop after the fast-forward as before/);
  });
});
