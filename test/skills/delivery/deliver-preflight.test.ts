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
const PERMISSIONS_MD = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/references/permissions.md',
);
const SKILL_MD = path.resolve(__dirname, '../../../skills/delivery/deliver/SKILL.md');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// #323: the preflight of `deliver` checks skills, allowlist and stale worktrees before the first PBI
describe.skipIf(!hasPwsh || process.platform === 'win32')('Test-DeliverPreflight.ps1', () => {
  let root: string;
  let repo: string;
  let home: string;
  let gh: ReturnType<typeof createFakeGh>;
  let worker: PwshWorker; // real detect-techstack: one case proves the integration
  let stubWorker: PwshWorker; // copy of the scripts with a stub detect-techstack: saves the real detect run (the script still spawns pwsh for it)
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const write = (file: string, content: string) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  };
  const runWith =
    (w: PwshWorker) =>
    async (...args: string[]) => {
      const r = await w.run(['-ProjectRoot', repo, ...args], {
        cwd: repo,
        env: { ...gh.env(), HOME: home },
      });
      const json = r.stdout.trim().startsWith('{') ? JSON.parse(r.stdout) : null;
      return { ...r, json, check: (n: string) => json?.checks.find((c: any) => c.name === n) };
    };
  const run = (...a: string[]) => runWith(worker)(...a);
  const runStub = (...a: string[]) => runWith(stubWorker)(...a);
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
    const stub = path.join(root, 'stub');
    fs.cpSync(path.dirname(SCRIPT), path.join(stub, 'deliver/scripts'), { recursive: true });
    write(
      path.join(stub, 'detect-techstack/scripts/Detect-TechStack.ps1'),
      `'{"languages":["ts"],"implementation":["ts-implementation"],"test":["ts-test"]}'\n`,
    );
    stubWorker = new PwshWorker(path.join(stub, 'deliver/scripts/Test-DeliverPreflight.ps1'));
  });
  afterAll(async () => {
    await worker.close();
    await stubWorker.close();
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

  it('reports missing stack skills', async () => {
    const miss = await runStub(...only('skills'));
    expect(miss.check('skills').status).toBe('action needed');
    expect(miss.check('skills').missing).toEqual(['ts-implementation', 'ts-test']);
    expect(miss.check('skills').fix).toBe('/skills-manage ts');
  });

  it('reports stack skills older than the global ones', async () => {
    for (const s of ['ts-implementation', 'ts-test']) {
      write(path.join(repo, '.claude/skills', s, 'SKILL.md'), 'x');
      write(path.join(home, '.claude/skills', s, 'SKILL.md'), 'x');
    }
    const past = new Date(Date.now() - 3600_000);
    const future = new Date(Date.now() + 3600_000);
    fs.utimesSync(path.join(repo, '.claude/skills/ts-implementation/SKILL.md'), future, future);
    fs.utimesSync(path.join(repo, '.claude/skills/ts-test/SKILL.md'), past, past);
    const old = await runStub(...only('skills'), '-Unattended');
    expect(old.check('skills').old).toEqual(['ts-test']);
    expect(old.check('skills').fix).toBe('continue with the global skills');
  });

  it('accepts current stack skills with the real detect-techstack', async () => {
    fs.rmSync(path.join(home, '.claude/skills/ts-test'), { recursive: true });
    // the only real detect run of the file: its report must name both ts skills
    const ok = (await run(...only('skills'))).check('skills');
    expect(ok.status).toBe('ok');
    expect(ok.detail).toBe('2 stack skills current');
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

  it('leaves a worktree when ls-remote fails', async () => {
    const dir = path.join(root, 'offline');
    git(repo, 'worktree', 'add', '-q', '-b', 'feat/16-q', dir);
    git(repo, 'push', '-q', 'origin', 'feat/16-q');
    git(repo, 'remote', 'set-url', 'origin', path.join(root, 'missing.git'));
    const r = await run(...only('worktrees'));
    git(repo, 'remote', 'set-url', 'origin', path.join(root, 'origin.git'));
    expect(r.check('worktrees').left).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: dir, reason: 'origin not reachable' }),
      ]),
    );
    expect(fs.existsSync(dir)).toBe(true);
  });

  it('prints one line per check with -Text and exits 1 outside a repository', async () => {
    const t = await runStub('-Text');
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

  it('permissions.md names the number of command kinds of its table', () => {
    const md = fs.readFileSync(PERMISSIONS_MD, 'utf8');
    const rows = md.split('\n').filter((l) => l.startsWith('| ')).length - 2; // minus header and separator
    const words = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
    expect(md).toContain(`${words[rows - 1]} kinds of shell commands`);
  });

  it('is wired into the Start of deliver with --no-preflight', () => {
    const skill = fs.readFileSync(SKILL_MD, 'utf8');
    expect(skill).toContain('Test-DeliverPreflight.ps1');
    expect(skill).toContain('--no-preflight');
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });
});
