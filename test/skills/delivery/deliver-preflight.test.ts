import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Test-DeliverPreflight.ps1',
);
const SKILL_MD = path.resolve(__dirname, '../../../skills/delivery/deliver/SKILL.md');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// #323: the preflight of `deliver` checks skills, allowlist and stale worktrees before the first PBI
describe.skipIf(!hasPwsh || process.platform === 'win32')('Test-DeliverPreflight.ps1', () => {
  let root: string;
  let repo: string;
  let home: string;
  let gh: ReturnType<typeof createFakeGh>;
  let worker: PwshWorker;
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const run = async (...args: string[]) => {
    const r = await worker.run(['-ProjectRoot', repo, ...args], {
      cwd: repo,
      env: { ...gh.env(), HOME: home },
    });
    const json = r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : null;
    return { ...r, json, check: (n: string) => json?.checks.find((c: any) => c.name === n) };
  };
  const only = (c: string) => ['-Check', c];
  const settings = path.join('.claude', 'settings.json');
  const allow = (entries: string[]) =>
    write(path.join(repo, settings), JSON.stringify({ permissions: { allow: entries } }));

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-')));
    const origin = path.join(root, 'origin.git');
    repo = path.join(root, 'repo');
    home = path.join(root, 'home');
    fs.mkdirSync(home);
    git(root, 'init', '-q', '--bare', '-b', 'release/next', origin);
    git(root, 'clone', '-q', origin, repo);
    for (const [k, v] of [
      ['user.email', 't@example.com'],
      ['user.name', 't'],
      ['commit.gpgsign', 'false'],
    ])
      git(repo, 'config', k, v);
    write(
      path.join(repo, 'AGENTS.md'),
      '# x\n\n```powershell\npnpm test\npnpm run build # b\n```\n',
    );
    write(path.join(repo, 'package.json'), '{"name":"x","devDependencies":{"vitest":"1"}}');
    write(path.join(repo, 'tsconfig.json'), '{}');
    write(path.join(repo, '.gitignore'), '.claude/\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'base');
    git(repo, 'push', '-q', 'origin', 'release/next');
    gh = createFakeGh(
      root,
      `(call) => {
        const a = call.args[1];
        if (a === 'repos/{owner}/{repo}') return { rest: { owner: { login: 'o' } } };
        if (a.includes('head=o:feat/12-x')) return { rest: [{ number: 9, merged_at: '2026-01-01' }] };
        if (a.includes('head=')) return { rest: [] };
        if (a.endsWith('/commits?per_page=100')) return { rest: [] };
        return { rest: { head: { ref: 'feat/12-x' }, base: { ref: 'release/next' } } };
      }`,
    );
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(async () => {
    await worker.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('lists missing allowlist entries with the exact settings lines, then adds them', async () => {
    allow(['Bash(gh api:*)']);
    const r = await run(...only('allowlist'), '-Harness', 'claude');
    expect(r.check('allowlist').status).toBe('action needed');
    expect(r.check('allowlist').missing).toEqual(
      expect.arrayContaining([
        'Bash(git:*)',
        'Bash(gh pr:*)',
        'Bash(pwsh .claude/skills/deliver/scripts/:*)',
        'Bash(pnpm test:*)',
        'Bash(pnpm run build:*)',
      ]),
    );
    expect(r.check('allowlist').missing).not.toContain('Bash(gh api:*)');

    const fixed = await run(...only('allowlist'), '-Harness', 'claude', '-AddAllowlist');
    expect(fixed.check('allowlist').status).toBe('fixed');
    const again = await run(...only('allowlist'), '-Harness', 'claude');
    expect(again.check('allowlist').status).toBe('ok');
    const saved = JSON.parse(fs.readFileSync(path.join(repo, settings), 'utf8'));
    expect(saved.permissions.allow).toContain('Bash(pnpm test:*)');
  });

  it('accepts whole-tool entries and checks opencode.json patterns', async () => {
    allow([
      'Bash(git:*)',
      'Bash(gh:*)',
      'Bash(pnpm:*)',
      'Bash(pwsh ~/.claude/skills/deliver/scripts/:*)',
    ]);
    expect((await run(...only('allowlist'))).check('allowlist').status).toBe('ok');
    write(
      path.join(repo, 'opencode.json'),
      JSON.stringify({ permission: { bash: { '*': 'ask', 'git *': 'allow' } } }),
    );
    const oc = await run(...only('allowlist'), '-Harness', 'opencode');
    expect(oc.check('allowlist').missing).toEqual(
      expect.arrayContaining(['gh pr *', 'pwsh *deliver/scripts/*', 'pnpm test *']),
    );
    expect(oc.check('allowlist').missing).not.toContain('git *');
  });

  it('reports missing, old and current stack skills', async () => {
    const miss = await run(...only('skills'));
    expect(miss.check('skills').status).toBe('action needed');
    expect(miss.check('skills').missing).toEqual(['ts-implementation', 'ts-test']);
    expect(miss.check('skills').fix).toBe('/skills-manage ts');

    for (const s of ['ts-implementation', 'ts-test']) {
      write(path.join(repo, '.claude/skills', s, 'SKILL.md'), 'x');
      write(path.join(home, '.claude/skills', s, 'SKILL.md'), 'x');
    }
    const past = new Date(Date.now() - 3600_000);
    const future = new Date(Date.now() + 3600_000);
    fs.utimesSync(path.join(repo, '.claude/skills/ts-implementation/SKILL.md'), future, future);
    fs.utimesSync(path.join(repo, '.claude/skills/ts-test/SKILL.md'), past, past);
    const old = await run(...only('skills'), '-Unattended');
    expect(old.check('skills').old).toEqual(['ts-test']);
    expect(old.check('skills').fix).toBe('continue with the global skills');
    fs.rmSync(path.join(home, '.claude/skills/ts-test'), { recursive: true });
    expect((await run(...only('skills'))).check('skills').status).toBe('ok');
  });

  it('removes worktrees of merged or deleted branches and lists the others', async () => {
    const wt = (n: string) => path.join(root, n);
    git(repo, 'worktree', 'add', '-q', '-b', 'feat/12-x', wt('merged'));
    git(repo, 'push', '-q', 'origin', 'feat/12-x');
    git(repo, 'worktree', 'add', '-q', '-b', 'feat/13-y', wt('open'));
    git(repo, 'push', '-q', 'origin', 'feat/13-y');
    git(repo, 'worktree', 'add', '-q', '-b', 'feat/14-z', wt('neverpushed'));
    git(repo, 'worktree', 'add', '-q', '-b', 'feat/15-w', wt('gone'));
    git(repo, 'push', '-q', 'origin', 'feat/15-w');
    git(path.join(root, 'origin.git'), 'branch', '-q', '-D', 'feat/15-w'); // deleted on origin

    const r = await run(...only('worktrees'));
    const c = r.check('worktrees');
    expect(c.status).toBe('action needed');
    expect(c.removed).toEqual(expect.arrayContaining([wt('merged'), wt('gone')]));
    expect(c.left).toHaveLength(2);
    expect(c.left).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: wt('open'), reason: 'branch still open' }),
        expect.objectContaining({ path: wt('neverpushed') }),
      ]),
    );
    expect(fs.existsSync(wt('neverpushed'))).toBe(true);
    expect(fs.existsSync(wt('merged'))).toBe(false);
    expect(fs.existsSync(wt('gone'))).toBe(false);
    expect(fs.existsSync(wt('open'))).toBe(true);
  });

  it('leaves a worktree when ls-remote fails and stays fast', async () => {
    const dir = path.join(root, 'offline');
    git(repo, 'worktree', 'add', '-q', '-b', 'feat/16-q', dir);
    git(repo, 'push', '-q', 'origin', 'feat/16-q');
    git(repo, 'remote', 'set-url', 'origin', path.join(root, 'missing.git'));
    const t0 = Date.now();
    const r = await run(...only('worktrees'));
    const ms = Date.now() - t0;
    git(repo, 'remote', 'set-url', 'origin', path.join(root, 'origin.git'));
    expect(r.check('worktrees').left).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: dir, reason: 'origin not reachable' }),
      ]),
    );
    expect(fs.existsSync(dir)).toBe(true);
    expect(ms).toBeLessThan(10_000); // preflight takes a few seconds at most
  });

  it('prints one line per check with -Text and exits 1 outside a repository', async () => {
    const t = await run('-Text');
    expect(t.stdout.trim().split('\n')).toHaveLength(3);
    expect(t.stdout).toMatch(/^preflight skills: /m);
    // own process: a ProjectRoot that is no git repository
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-plain-'));
    const bad = spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, '-ProjectRoot', plain], {
      encoding: 'utf8',
    });
    fs.rmSync(plain, { recursive: true, force: true });
    expect(bad.status).toBe(1);
  });

  it('is wired into the Start of deliver with --no-preflight', () => {
    const skill = fs.readFileSync(SKILL_MD, 'utf8');
    expect(skill).toContain('Test-DeliverPreflight.ps1');
    expect(skill).toContain('--no-preflight');
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });
});
