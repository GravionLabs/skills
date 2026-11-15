import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #671: a missing origin/release/next is created from the default branch by the release-branch check (New-ReleaseNext.ps1 of github-release)
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Test-DeliverPreflight.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'release-branch check creates release/next',
  () => {
    let root: string;
    let repo: string;
    let origin: string;
    let worker: PwshWorker;
    let gh: ReturnType<typeof createFakeGh>;
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    const run = async () => {
      const r = await worker.run(['-ProjectRoot', repo, '-Check', 'release-branch'], {
        cwd: repo,
        env: gh.env(),
      });
      return JSON.parse(r.stdout).checks[0];
    };
    const onOrigin = () =>
      git(origin, 'for-each-ref', '--format=%(refname)', 'refs/heads/release/next');

    beforeAll(() => {
      root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-rn-')));
      origin = path.join(root, 'origin.git');
      repo = path.join(root, 'repo');
      git(root, 'init', '-q', '--bare', '-b', 'main', origin);
      git(root, 'clone', '-q', origin, repo);
      for (const [k, v] of [
        ['user.email', 't@example.com'],
        ['user.name', 't'],
        ['commit.gpgsign', 'false'],
      ])
        git(repo, 'config', k, v);
      fs.writeFileSync(path.join(repo, 'README.md'), 'x\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'base');
      git(repo, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
      gh = createFakeGh(
        root,
        `(call) => call.args[1] === 'repos/{owner}/{repo}' && call.args.includes('--jq') ? { rest: 'main' } : { rest: [] }`,
      );
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(async () => {
      await worker.close();
      fs.rmSync(root, { recursive: true, force: true });
    });

    it('refused push: action needed with the git error, nothing created', async () => {
      const hook = path.join(origin, 'hooks', 'pre-receive');
      fs.mkdirSync(path.dirname(hook), { recursive: true });
      fs.writeFileSync(hook, '#!/bin/sh\necho "ruleset: no new branches" >&2\nexit 1\n', {
        mode: 0o755,
      });
      try {
        const c = await run();
        expect(c.status).toBe('action needed');
        expect(c.detail).toContain('refused');
        expect(c.detail).toContain('ruleset: no new branches');
        expect(onOrigin()).toBe('');
      } finally {
        fs.rmSync(hook);
      }
    });

    it('missing: created from the default branch, fixed with notes, then ok', async () => {
      const c = await run();
      expect(c.status).toBe('fixed');
      expect(c.detail).toBe('release/next created from main');
      expect(c.notes).toEqual([
        expect.stringContaining('no required checks on release/next'),
        expect.stringContaining('no .github/workflows/release-branch.yml'),
      ]);
      expect(git(origin, 'rev-parse', 'release/next')).toBe(git(origin, 'rev-parse', 'main'));
      expect((await run()).status).toBe('ok');
    });

    it('unreachable origin stays ok, not checked, and creates nothing', async () => {
      git(origin, 'update-ref', '-d', 'refs/heads/release/next');
      git(repo, 'remote', 'set-url', 'origin', path.join(root, 'missing.git'));
      try {
        const c = await run();
        expect(c.status).toBe('ok');
        expect(c.detail).toContain('not checked');
      } finally {
        git(repo, 'remote', 'set-url', 'origin', origin);
      }
      expect(onOrigin()).toBe('');
    });
  },
);
