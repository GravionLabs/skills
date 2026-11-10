import * as fs from 'fs';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';
import { useReleaseFixture } from '../../helpers/release-fixture';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-release/scripts/Get-ReleaseState.ps1');

const fx = useReleaseFixture();
const { git, commit, dropRef, resetHeads } = fx;

// #769: guards around release/next (fast-forward, never delete), stale lines, workflow detection, read-only and input validation.

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
      `(call) => {
        const a = call.args;
        if (a[0] === 'repo') return { rest: process.env.FAKE_SLUG || '' };
        if (a[0] === 'api' && a.includes('graphql')) return { rest: JSON.parse(process.env.FAKE_GRAPHQL || '{}') };
        if (a[0] === 'api' && /rules\\/branches/.test(a[1])) return { rest: JSON.parse(process.env.FAKE_RULES || '[]') };
        if (a[0] === 'api') return { rest: process.env.FAKE_DELETE_ON_MERGE || '' };
        return { rest: JSON.parse((a.includes('--head') ? process.env.FAKE_RELEASE_PR : process.env.FAKE_PRS) || '[]') };
      }`,
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
    it('merged tip without open PRs: finish and cut fast-forward it, neither touches origin', async () => {
      setRef('release/next', 'v2.1.0^2');
      const before = git(fx.origin, 'for-each-ref');
      expect(await state('finish', 'release/next')).toMatchObject({
        state: 'merged',
        fastForwardAllowed: true,
        action: 'fast-forward',
      });
      expect(await state('cut', 'release/next')).toMatchObject({ action: 'fast-forward' });
      // read-only: the script only reports fast-forward, it never pushes or deletes
      expect(git(fx.origin, 'for-each-ref')).toBe(before);
    });

    it('released without merge tip: cut fast-forwards', async () => {
      setRef('release/next', 'release/legacy');
      expect(await state('cut', 'release/next')).toMatchObject({
        state: 'released',
        fastForwardAllowed: true,
        action: 'fast-forward',
      });
    });

    it('open PRs do not block the fast-forward (#528)', async () => {
      setRef('release/next', 'v2.1.0^2');
      const prs = { FAKE_PRS: '[{"number":5,"title":"t","url":"u"}]' };
      expect(await state('cut', 'release/next', prs)).toMatchObject({
        fastForwardAllowed: true,
        action: 'fast-forward',
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
          fastForwardAllowed: false,
          action: 'stop: local commits block the reset',
        });
      } finally {
        git(fx.clone, 'checkout', '-q', 'main');
        git(fx.clone, 'branch', '-q', '-D', 'release/next');
      }
    });
  });

  describe('release/next deletion guard (#528)', () => {
    const repo = { FAKE_SLUG: 'GravionLabs/demo', FAKE_DELETE_ON_MERGE: 'true' };

    it('warns when delete_branch_on_merge is on and the ruleset has no deletion rule', async () => {
      setRef('release/next', 'release/legacy');
      const r = await state('finish', 'release/next', {
        ...repo,
        FAKE_RULES: '[{"type":"non_fast_forward"}]',
      });
      expect(r).toMatchObject({ deleteOnMerge: true, deletionRule: false });
      expect(r.warning).toContain('no deletion rule');
    });

    it('no warning with the deletion rule', async () => {
      setRef('release/next', 'release/legacy');
      const r = await state('finish', 'release/next', {
        ...repo,
        FAKE_RULES: '[{"type":"deletion"}]',
      });
      expect(r).toMatchObject({ deleteOnMerge: true, deletionRule: true, warning: null });
    });

    it('lists open PRs that GitHub moved from release/next to main', async () => {
      setRef('release/next', 'release/legacy');
      const graphql = {
        data: {
          repository: {
            pullRequests: {
              nodes: [
                {
                  number: 7,
                  title: 'moved',
                  url: 'u7',
                  timelineItems: { nodes: [{ previousRefName: 'release/next' }] },
                },
                { number: 8, title: 'plain', url: 'u8', timelineItems: { nodes: [] } },
              ],
            },
          },
        },
      };
      const r = await state('finish', 'release/next', {
        ...repo,
        FAKE_RULES: '[{"type":"deletion"}]',
        FAKE_GRAPHQL: JSON.stringify(graphql),
      });
      expect(r.retargetedPrs).toEqual([{ number: 7, title: 'moved', url: 'u7' }]);
      expect(r.warning).toContain('#7');
    });

    it('stays silent when gh cannot tell', async () => {
      setRef('release/next', 'release/legacy');
      const r = await state('finish', 'release/next');
      expect(r).toMatchObject({
        deleteOnMerge: null,
        deletionRule: null,
        retargetedPrs: [],
        warning: null,
      });
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
      'uses: GravionLabs/ci/.github/workflows/release-branch.yml@v1\n',
    );
    try {
      expect((await state('cut', 'release/next')).releaseWorkflow).toBe(true);
    } finally {
      fs.rmSync(path.join(fx.clone, '.github'), { recursive: true, force: true });
    }
  });

  it('releaseWorkflow is true when a workflow calls release-branch.yml by its local path (#506)', async () => {
    const wf = path.join(fx.clone, '.github/workflows');
    fs.mkdirSync(wf, { recursive: true });
    fs.writeFileSync(path.join(wf, 'rb.yml'), 'uses: ./.github/workflows/release-branch.yml\n');
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

  it('names the merge command and the fast-forward path', () => {
    expect(step4).toContain('gh pr merge <nr> --merge');
    expect(step4).toContain('fast-forward');
  });

  it('never waits for the user in the fork', () => {
    expect(skill).not.toMatch(/when the user confirms/i);
    expect(skill).not.toContain('gh pr view <nr> --json merged');
  });
});
