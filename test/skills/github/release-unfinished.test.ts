import * as fs from 'fs';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';
import { useReleaseFixture } from '../../helpers/release-fixture';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-release/scripts/Get-ReleaseState.ps1');

const fx = useReleaseFixture();
const { git, resetHeads } = fx;

// #1039: a draft release without a tag is an unfinished release (the release job failed after the merge).
describe('Get-ReleaseState.ps1 (unfinished release)', () => {
  let worker: PwshWorker;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    const ghDir = path.join(fx.tmp, 'fake-gh');
    fs.mkdirSync(ghDir);
    // run 11 failed in a test job only, run 22 in the publish job
    fake = createFakeGh(
      ghDir,
      `(call) => {
        const [a, b, c] = call.args;
        if (a === 'release') return { rest: JSON.parse(process.env.FAKE_RELEASES || '[]') };
        if (a === 'run' && b === 'list') return { rest: JSON.parse(process.env.FAKE_RUNS || '[]') };
        if (a === 'run') return { rest: { jobs: [{ name: c === '22' ? 'publish release' : 'test', conclusion: 'failure' }] } };
        return { rest: [] };
      }`,
    );
  });
  afterAll(() => worker.close());
  beforeEach(() => {
    resetHeads();
    git(fx.origin, 'update-ref', 'refs/heads/release/next', 'release/legacy');
  });

  const release = (tagName: string, isDraft = true, isPrerelease = false) => ({
    tagName,
    isDraft,
    isPrerelease,
  });
  const runs = [
    { databaseId: 11, url: 'https://x/runs/11' },
    { databaseId: 22, url: 'https://x/runs/22' },
  ];
  const finish = async (releases: object[], failed: object[] = runs) => {
    const r = await worker.run(['-Mode', 'finish', '-Branch', 'release/next'], {
      cwd: fx.clone,
      env: {
        ...fake.env(fx.env),
        FAKE_RELEASES: JSON.stringify(releases),
        FAKE_RUNS: JSON.stringify(failed),
      },
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };

  it('warns about a draft without a tag and names the failed release run', async () => {
    const r = await finish([release('v99.0.0'), release('v2.3.0', false)]);
    expect(r.warning).toContain('unfinished release v99.0.0: draft without a tag');
    expect(r.warning).toContain('`gh run rerun 22 --failed` (https://x/runs/22)');
  });

  it('warns without a run id when no failed release run is found', async () => {
    const r = await finish([release('v99.0.0')], [runs[0]]);
    expect(r.warning).toContain('`gh run rerun <run id> --failed`');
  });

  it('a stop of a released branch names the unfinished release instead', async () => {
    git(fx.clone, 'fetch', '-q', 'origin');
    git(fx.clone, 'checkout', '-q', '-B', 'release/next', 'origin/release/next');
    fx.commit(fx.clone, 'local');
    try {
      const r = await finish([release('v99.0.0')]);
      expect(r.action).toMatch(/^stop: unfinished release v99\.0\.0/);
    } finally {
      git(fx.clone, 'checkout', '-q', 'main');
      git(fx.clone, 'branch', '-q', '-D', 'release/next');
    }
  });

  it.each([
    ['a draft whose tag exists', [release('v2.3.0')]],
    ['a published newest release over an older draft', [release('v2.3.0', false), release('v99')]],
    ['a pre-release draft', [release('v99.0.0-rc.1', true, true)]],
    ['an -rc.N draft not marked as pre-release', [release('v99.0.0-rc.2')]],
  ])('no warning for %s', async (_name, releases) => {
    expect((await finish(releases)).warning).toBeNull();
  });
});
