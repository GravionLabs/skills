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
      gh = createFakeGh(dir, '(call) => ({ rest: [] })');
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

    it('exits 3 before any agent starts when origin/release/next is missing', async () => {
      git(path.join(dir, 'origin.git'), 'update-ref', '-d', 'refs/heads/release/next');
      try {
        const r = await worker.run(['-Target', '10'], {
          cwd: repo,
          env: { ...gh.env(), HERDR_ENV: '', NO_COLOR: '' },
        });
        expect(r.status).toBe(3);
        expect(r.stdout).toContain('release/next is missing');
        expect(r.stdout).toContain('github-release cut');
        expect(fs.existsSync(agentMarker())).toBe(false);
      } finally {
        git(repo, 'push', '-q', 'origin', 'release/next');
      }
    });
  },
);
