import * as fs from 'fs';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';
import { useReleaseFixture } from '../../helpers/release-fixture';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-release/scripts/Get-ReleaseState.ps1');

const fx = useReleaseFixture();
const { git, dropRef, resetHeads } = fx;

// #378: finish with an open release-test issue warns; release.test.gate: true refuses.
describe('Get-ReleaseState.ps1 -Milestone (RC test)', () => {
  let worker: PwshWorker;
  let fake: ReturnType<typeof createFakeGh>;
  const cfgDir = () => path.join(fx.clone, '.agents');
  beforeAll(() => {
    worker = new PwshWorker(script);
    const ghDir = path.join(fx.tmp, 'fake-gh');
    fs.mkdirSync(ghDir);
    fake = createFakeGh(
      ghDir,
      `(call) => ({ rest: JSON.parse((call.args[0] === 'issue' ? (call.args.includes('--milestone') ? process.env.FAKE_TEST_ISSUES : process.env.FAKE_ALL_ISSUES) : '[]') || '[]') })`,
    );
  });
  afterAll(() => worker.close());
  beforeEach(() => {
    resetHeads();
    git(
      fx.origin,
      'update-ref',
      'refs/heads/release/3.1',
      git(fx.origin, 'commit-tree', 'main^{tree}', '-p', 'main', '-m', 'U'),
    );
  });
  afterEach(() => {
    dropRef('refs/heads/release/3.1');
    fs.rmSync(cfgDir(), { recursive: true, force: true });
  });

  const finish = async (issues: string, gate?: boolean, milestone = 'M4', all = '[]') => {
    if (gate !== undefined) {
      fs.mkdirSync(cfgDir(), { recursive: true });
      fs.writeFileSync(
        path.join(cfgDir(), 'config.json'),
        JSON.stringify({ release: { test: { gate } } }),
      );
    }
    const r = await worker.run(
      ['-Mode', 'finish', '-Branch', 'release/3.1', '-Milestone', milestone],
      {
        cwd: fx.clone,
        env: { ...fake.env(fx.env), FAKE_TEST_ISSUES: issues, FAKE_ALL_ISSUES: all },
      },
    );
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };
  const open = '[{"number":7,"url":"https://x/issues/7"}]';

  it('gate off (default): an open release-test issue warns, the release PR goes ahead', async () => {
    expect(await finish(open)).toMatchObject({
      action: 'release-pr',
      gate: false,
      releaseTest: { number: 7 },
      warning: 'RC test open: https://x/issues/7',
    });
  });

  it('gate on: refuses while the release-test issue is open', async () => {
    const r = await finish(open, true);
    expect(r.gate).toBe(true);
    expect(r.action).toBe(
      'stop: release.test.gate is true, close the RC test https://x/issues/7 first',
    );
  });

  it('gate on, issue closed: no warning, release PR', async () => {
    expect(await finish('[]', true)).toMatchObject({
      action: 'release-pr',
      releaseTest: null,
      warning: null,
    });
  });

  it('asks gh for the open release-test issues of the milestone', async () => {
    await finish('[]');
    const call = fake.calls().find((c) => c.args[0] === 'issue')!;
    expect(call.args).toEqual(
      expect.arrayContaining(['--label', 'release-test', '--state', 'open', '--milestone', 'M4']),
    );
  });

  it('lists open release-test issues of other milestones to close as superseded', async () => {
    const all =
      '[{"number":7,"url":"https://x/issues/7","milestone":{"title":"M4"}},{"number":3,"url":"https://x/issues/3","milestone":{"title":"M3"}}]';
    const r = await finish(open, undefined, 'M4', all);
    expect(r.olderReleaseTests).toEqual([{ number: 3, url: 'https://x/issues/3' }]);
    expect((await finish('[]')).olderReleaseTests).toEqual([]);
  });
});
