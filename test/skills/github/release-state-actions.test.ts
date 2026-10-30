import * as fs from 'fs';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';
import { useReleaseFixture } from '../../helpers/release-fixture';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-release/scripts/Get-ReleaseState.ps1');

const fx = useReleaseFixture();
const { git, commit, dropRef, resetHeads } = fx;

// #769: guards around release/next (delete, recreate), stale lines, workflow detection, read-only and input validation.

describe('Get-ReleaseState.ps1', () => {
  let worker: PwshWorker;
  let ghDir: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    ghDir = path.join(fx.tmp, 'fake-gh');
    fs.mkdirSync(ghDir);
    fake = createFakeGh(
      ghDir,
      `(call) => ({ rest: JSON.parse((call.args.includes('--head') ? process.env.FAKE_RELEASE_PR : process.env.FAKE_PRS) || '[]') })`,
    );
  });
  afterAll(() => worker.close());
  beforeEach(resetHeads);
  afterEach(() => {
    for (const b of ['3.0', '3.1', '3.2', '1.0', '7.7']) dropRef(`refs/heads/release/${b}`);
  });

  const state = async (
    mode: 'cut' | 'finish',
    branch: string,
    extra: Record<string, string> = {},
  ) => {
    const r = await worker.run(['-Mode', mode, '-Branch', branch], {
      cwd: fx.clone,
      env: { ...fake.env(fx.env), ...extra },
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };
  const setRef = (b: string, sha: string) => git(fx.origin, 'update-ref', `refs/heads/${b}`, sha);

  describe('release/next merged or released', () => {
    it('merged tip without open PRs: finish deletes it, cut recreates it, neither touches origin', async () => {
      setRef('release/next', 'v2.1.0^2');
      const before = git(fx.origin, 'for-each-ref');
      expect(await state('finish', 'release/next')).toMatchObject({
        state: 'merged',
        deleteAllowed: true,
        action: 'delete-branch',
      });
      expect(await state('cut', 'release/next')).toMatchObject({ action: 'recreate' });
      // read-only: the script only reports delete-branch / recreate, it never pushes or deletes
      expect(git(fx.origin, 'for-each-ref')).toBe(before);
    });

    it('released without merge tip: cut recreates', async () => {
      setRef('release/next', 'release/legacy');
      expect(await state('cut', 'release/next')).toMatchObject({
        state: 'released',
        deleteAllowed: true,
        action: 'recreate',
      });
    });

    it('open PRs block delete and recreate', async () => {
      setRef('release/next', 'v2.1.0^2');
      const prs = { FAKE_PRS: '[{"number":5,"title":"t","url":"u"}]' };
      expect(await state('cut', 'release/next', prs)).toMatchObject({
        deleteAllowed: false,
        action: 'stop: open PRs or local commits block the reset',
      });
    });

    it('local commits ahead of origin block the reset', async () => {
      setRef('release/next', 'release/legacy');
      git(fx.clone, 'fetch', '-q', 'origin');
      git(fx.clone, 'checkout', '-q', '-B', 'release/next', 'origin/release/next');
      commit(fx.clone, 'local');
      try {
        expect(await state('cut', 'release/next')).toMatchObject({
          localAhead: 1,
          deleteAllowed: false,
          action: 'stop: open PRs or local commits block the reset',
        });
      } finally {
        git(fx.clone, 'checkout', '-q', 'main');
        git(fx.clone, 'branch', '-q', '-D', 'release/next');
      }
    });
  });

  it('lists released release/<x.y> lines as stale, sorted by version; no release workflow', async () => {
    const r = await state('cut', 'release/next');
    expect(r.staleLines).toEqual(['release/2.1', 'release/9.0']);
    expect(r.releaseWorkflow).toBe(false);
  });

  it('releaseWorkflow is true when a workflow calls the reusable release-branch.yml', async () => {
    const wf = path.join(fx.clone, '.github/workflows');
    fs.mkdirSync(wf, { recursive: true });
    fs.writeFileSync(
      path.join(wf, 'rb.yml'),
      'uses: GravionLabs/ci/.github/workflows/release-branch.yml@main\n',
    );
    try {
      expect((await state('cut', 'release/next')).releaseWorkflow).toBe(true);
    } finally {
      fs.rmSync(path.join(fx.clone, '.github'), { recursive: true, force: true });
    }
  });

  it('invalid branch name: exit 1 with a message on stderr', async () => {
    const r = await worker.run(['-Mode', 'finish', '-Branch', 'feature/x'], {
      cwd: fx.clone,
      env: fake.env(fx.env),
    });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("invalid branch name 'feature/x'");
    expect(r.stdout).toBe('');
  });
});

describe('github-release SKILL.md finish step 4', () => {
  const skill = fs.readFileSync(path.join(root, 'skills/github/github-release/SKILL.md'), 'utf8');
  const step4 = skill.split('\n').find((l) => l.startsWith('4. Report the PR URL')) ?? '';

  it('names the merge command and the delete-branch path', () => {
    expect(step4).toContain('gh pr merge <nr> --merge');
    expect(step4).toContain('delete-branch');
  });

  it('never waits for the user in the fork', () => {
    expect(skill).not.toMatch(/when the user confirms/i);
    expect(skill).not.toContain('gh pr view <nr> --json merged');
  });
});
