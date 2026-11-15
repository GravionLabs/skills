import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #633: Invoke-DeliverLoop.ps1 checks origin/release/next before its first iteration: missing means exit 3 with a
// message, no agent started, no PBI labeled. Own file: the loop test files are at their time budget.
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/deliver/scripts/Invoke-DeliverLoop.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe.skipIf(!hasPwsh || process.platform === 'win32')(
  'Invoke-DeliverLoop.ps1 release/next guard',
  () => {
    let dir: string;
    let repo: string;
    let worker: PwshWorker;
    let gh: ReturnType<typeof createFakeGh>;
    const git = (cwd: string, ...args: string[]) =>
      execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
    const agentMarker = () => path.join(dir, 'agent-started');

    beforeAll(() => {
      dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'loop-release-branch-')));
      const origin = path.join(dir, 'origin.git');
      repo = path.join(dir, 'repo');
      git(dir, 'init', '-q', '--bare', '-b', 'release/next', origin);
      git(dir, 'clone', '-q', origin, repo);
      git(repo, 'config', 'user.email', 't@example.com');
      git(repo, 'config', 'user.name', 't');
      git(repo, 'config', 'commit.gpgsign', 'false');
      fs.writeFileSync(path.join(repo, 'README.md'), 'x\n');
      git(repo, 'add', '-A');
      git(repo, 'commit', '-q', '-m', 'base');
      git(repo, 'push', '-q', 'origin', 'release/next');
      git(repo, 'push', '-q', 'origin', 'HEAD:refs/heads/main');
      gh = createFakeGh(
        dir,
        `(call) => call.args[1] === 'repos/{owner}/{repo}' && call.args.includes('--jq') ? { rest: 'main' } : { rest: [] }`,
      );
      // a harness stub that records that an agent started
      fs.writeFileSync(path.join(gh.bin, 'claude'), `#!/bin/sh\ntouch ${agentMarker()}\n`, {
        mode: 0o755,
      });
      worker = new PwshWorker(SCRIPT);
    });
    afterAll(async () => {
      await worker.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    const dropBranch = () =>
      git(path.join(dir, 'origin.git'), 'update-ref', '-d', 'refs/heads/release/next');
    const runLoop = () =>
      worker.run(['-Target', '10'], {
        cwd: repo,
        env: { ...gh.env(), HERDR_ENV: '', NO_COLOR: '' },
      });

    // #671: a refused push keeps the exit 3 of #633
    it('exits 3 before any agent starts when release/next is missing and the push is refused', async () => {
      dropBranch();
      const hook = path.join(dir, 'origin.git', 'hooks', 'pre-receive');
      fs.mkdirSync(path.dirname(hook), { recursive: true });
      fs.writeFileSync(hook, '#!/bin/sh\necho "ruleset: no new branches" >&2\nexit 1\n', {
        mode: 0o755,
      });
      try {
        const r = await runLoop();
        expect(r.status).toBe(3);
        expect(r.stdout).toContain('release/next is missing');
        expect(r.stdout).toContain('ruleset: no new branches');
        expect(r.stdout).toContain('github-release cut');
        expect(fs.existsSync(agentMarker())).toBe(false);
      } finally {
        fs.rmSync(hook);
        git(repo, 'push', '-q', 'origin', 'release/next');
      }
    });

    it('creates a missing release/next from the default branch and goes on', async () => {
      dropBranch();
      try {
        const r = await runLoop();
        expect(r.status).not.toBe(3);
        expect(r.stdout).toContain('release/next created from main');
        const origin = path.join(dir, 'origin.git');
        expect(git(origin, 'rev-parse', 'release/next')).toBe(git(origin, 'rev-parse', 'main'));
      } finally {
        git(repo, 'push', '-q', 'origin', 'release/next');
      }
    });
  },
);
