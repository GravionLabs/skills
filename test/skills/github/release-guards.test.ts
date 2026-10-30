import * as fs from 'fs';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';
import { useReleaseFixture } from '../../helpers/release-fixture';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-release/scripts/Get-ReleaseState.ps1');

const fx = useReleaseFixture();
const { git, dropRef, resetHeads } = fx;

// #252 / #769: the state checks of github-release live in scripts/Get-ReleaseState.ps1 (JSON result).
// History: main A - M1 (merge of release/2.1 = B, tag v2.1.0) - H (hotfix) - M2 (merge of release/next = D, tag v2.3.0);
// release/2.2 = C from M1, release/legacy = A, release/2.1 continued with E, release/next continued with F, release/9.0 = A tagged v9.0.0.

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
  const child = (parent: string, ...msg: string[]) =>
    git(
      fx.origin,
      'commit-tree',
      `${parent}^{tree}`,
      '-p',
      parent,
      ...msg.flatMap((m) => ['-m', m]),
    );

  it('absent: the branch is not on origin (cut creates it)', async () => {
    const r = await state('cut', 'release/7.7');
    expect(r).toMatchObject({
      default: 'main',
      branch: 'release/7.7',
      state: 'absent',
      action: 'create',
      openPrs: [],
      localAhead: 0,
      deleteAllowed: false,
    });
    expect((await state('finish', 'release/7.7')).action).toBe('stop: branch not on origin');
  });

  it('fresh: equal to main, finish has nothing to release', async () => {
    setRef('release/3.0', 'main');
    expect(await state('finish', 'release/3.0')).toMatchObject({
      state: 'fresh',
      action: 'stop: nothing to release',
    });
  });

  it('unreleased: own commits on top of main, finish opens the release PR', async () => {
    setRef('release/3.1', child('main', 'U'));
    const cut = await state('cut', 'release/3.1');
    expect(cut).toMatchObject({
      state: 'unreleased',
      action: 'noop',
      hasSemverCommit: false,
      hasMajorCommit: false,
    });
    expect(await state('finish', 'release/3.1')).toMatchObject({
      state: 'unreleased',
      action: 'release-pr',
      releasePr: null,
    });
  });

  it('reports +semver commits and the CI release PR', async () => {
    setRef('release/3.2', child('main', 'chore: release major', '+semver: major'));
    const r = await state('finish', 'release/3.2', {
      FAKE_RELEASE_PR: '[{"number":9,"url":"https://x/9"}]',
    });
    expect(r).toMatchObject({
      hasSemverCommit: true,
      hasMajorCommit: true,
      releasePr: { number: 9, url: 'https://x/9' },
    });
  });

  it('unreleased with open PRs: finish stops and lists them', async () => {
    setRef('release/3.1', child('main', 'U'));
    const r = await state('finish', 'release/3.1', {
      FAKE_PRS: '[{"number":5,"title":"t","url":"https://x/5"}]',
    });
    expect(r.openPrs).toEqual([{ number: 5, title: 't', url: 'https://x/5' }]);
    expect(r.action).toBe('stop: open PRs target the branch; merge them first');
  });

  it('behind: main has commits the branch lacks (release/2.2)', async () => {
    expect(await state('finish', 'release/2.2')).toMatchObject({
      state: 'behind',
      action: 'stop: behind main; merge it in first',
    });
  });

  it('released-continued: .0 tag exists and the branch moved on (release/2.1)', async () => {
    const r = await state('finish', 'release/2.1');
    expect(r.state).toBe('released-continued');
    expect(r.action).toBe('stop: already released; cut a new release branch');
  });

  it('released-continued: release/next continued after its merge (no <x.y> tag to check)', async () => {
    expect((await state('finish', 'release/next')).state).toBe('released-continued');
  });

  it('merged: the tip is the second parent of a merge on main (release/1.0 = v2.1.0^2)', async () => {
    setRef('release/1.0', 'v2.1.0^2');
    const r = await state('finish', 'release/1.0');
    expect(r).toMatchObject({ state: 'merged', deleteAllowed: false });
    expect(r.action).toBe('stop: already released; cut a new release branch');
  });

  it('released: ancestor of main but no merge tip (release/9.0)', async () => {
    expect((await state('finish', 'release/9.0')).state).toBe('released');
  });
});
