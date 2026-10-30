import * as fs from 'fs';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';
import { useReleaseFixture } from '../../helpers/release-fixture';

// Resolve the integration branch (release-branches.md steps 2-4, #252, #779) through Get-ReleaseState.ps1 -Mode base,
// run against the shared release fixture.
const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-release/scripts/Get-ReleaseState.ps1');

const fx = useReleaseFixture();
const { git, dropRef, resetHeads } = fx;

describe('Get-ReleaseState.ps1 -Mode base', () => {
  let worker: PwshWorker;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    const ghDir = path.join(fx.tmp, 'fake-gh-base');
    fs.mkdirSync(ghDir);
    // FAKE_ISSUES maps issue numbers to bodies; an unknown number fails like `gh issue view` does
    fake = createFakeGh(
      ghDir,
      `(call) => {
        const bodies = JSON.parse(process.env.FAKE_ISSUES || '{}');
        const nr = call.args[2];
        if (call.args[0] !== 'issue' || call.args[1] !== 'view' || !(nr in bodies)) throw new Error('not found: ' + nr);
        return { rest: { body: bodies[nr] } };
      }`,
    );
  });
  afterAll(() => worker.close());
  beforeEach(resetHeads);
  afterEach(() => git(fx.clone, 'checkout', '-q', 'main'));

  const run = (args: string[], issues: Record<string, string> = {}) =>
    worker.run(['-Mode', 'base', ...args], {
      cwd: fx.clone,
      env: { ...fake.env(fx.env), FAKE_ISSUES: JSON.stringify(issues) },
    });
  const base = async (args: string[] = [], issues: Record<string, string> = {}) => {
    const r = await run(args, issues);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };

  describe('origin (step 4)', () => {
    it('prefers release/next when it exists', async () => {
      expect(await base()).toEqual({ base: 'release/next', source: 'origin', warning: null });
    });

    it('skips release/<x.y> lines whose v<x.y>.0 tag is on origin (even the highest) and legacy names', async () => {
      dropRef('refs/heads/release/next');
      expect(await base()).toEqual({ base: 'release/2.2', source: 'origin', warning: null });
    });

    it('returns none with exit 0 when every release/<x.y> is released', async () => {
      dropRef('refs/heads/release/next');
      dropRef('refs/heads/release/2.2');
      expect(await base()).toEqual({ base: null, source: 'none', warning: null });
    });
  });

  describe('released, not reset', () => {
    it('warns when release/next is an ancestor of main but not equal to it', async () => {
      git(fx.origin, 'update-ref', 'refs/heads/release/next', 'release/legacy');
      expect(await base()).toEqual({
        base: 'release/next',
        source: 'origin',
        warning: 'released, not reset: run github-release cut',
      });
    });

    it('does not warn when release/next equals main (fresh)', async () => {
      git(fx.origin, 'update-ref', 'refs/heads/release/next', 'main');
      expect((await base()).warning).toBeNull();
    });
  });

  describe('current branch (step 3)', () => {
    it('uses the current release/* branch before origin', async () => {
      git(fx.clone, 'checkout', '-q', '-B', 'release/2.1', 'origin/release/2.1');
      expect(await base()).toEqual({ base: 'release/2.1', source: 'current', warning: null });
    });

    it('ignores a current branch outside release/*', async () => {
      git(fx.clone, 'checkout', '-q', '-B', 'feat/1-x', 'origin/main');
      expect((await base()).source).toBe('origin');
    });
  });

  describe('issue line (step 2)', () => {
    it('reads the Release branch: line of the issue before the current branch', async () => {
      git(fx.clone, 'checkout', '-q', '-B', 'release/2.1', 'origin/release/2.1');
      const issues = { '12': 'Parent Feature: #3\nRelease branch: release/2.2\n\nbody' };
      expect(await base(['-Issue', '12'], issues)).toEqual({
        base: 'release/2.2',
        source: 'issue',
        warning: null,
      });
    });

    it('follows Parent lines one level at a time to the first Release branch: line', async () => {
      const issues = {
        '30': 'Parent PBI: #20\r\n\r\ntask',
        '20': 'Parent Feature: #10\n\npbi',
        '10': 'Parent Epic: #1\nRelease branch: `release/2.2`\n',
        '1': 'Release branch: release/next',
      };
      expect(await base(['-Issue', '30'], issues)).toEqual({
        base: 'release/2.2',
        source: 'issue',
        warning: null,
      });
    });

    it('falls through to origin when neither the issue nor its parents name a branch', async () => {
      const issues = { '5': 'Parent Feature: #4\n\nRelease branch: main', '4': 'no line' };
      expect(await base(['-Issue', '5'], issues)).toEqual({
        base: 'release/next',
        source: 'origin',
        warning: null,
      });
    });

    it('stops on a Parent cycle', async () => {
      const issues = { '8': 'Parent PBI: #9', '9': 'Parent Feature: #8' };
      expect((await base(['-Issue', '8'], issues)).source).toBe('origin');
    });

    it('fails when gh cannot read the issue', async () => {
      const r = await run(['-Issue', '404']);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('gh issue view 404 failed');
    });
  });

  describe('explicit input (step 1)', () => {
    it('returns -Branch unchanged before the issue line', async () => {
      expect(
        await base(['-Branch', 'main', '-Issue', '7'], { '7': 'Release branch: release/2.2' }),
      ).toEqual({
        base: 'main',
        source: 'input',
        warning: null,
      });
    });
  });
});
