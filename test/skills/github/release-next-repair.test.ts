import * as fs from 'fs';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';
import { useReleaseFixture } from '../../helpers/release-fixture';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-release/scripts/Repair-ReleaseNext.ps1');

const fx = useReleaseFixture();
const { git, dropRef, resetHeads } = fx;

// #1038: GitHub deletes release/next when the owner merges the release PR; finish repairs it.
describe('Repair-ReleaseNext.ps1', () => {
  let worker: PwshWorker;
  let ghDir: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    ghDir = path.join(fx.tmp, 'fake-gh');
    fs.mkdirSync(ghDir);
    const moved = (number: number) => ({
      number,
      title: 't',
      url: `u${number}`,
      timelineItems: { nodes: [{ previousRefName: 'release/next' }] },
    });
    const nodes = [moved(7), moved(8), { ...moved(9), timelineItems: { nodes: [] } }];
    fake = createFakeGh(
      ghDir,
      `(call) => {
        const a = call.args;
        if (a[0] === 'repo') return { rest: 'GravionLabs/demo' };
        if (a[0] === 'api' && a.includes('graphql')) return { rest: ${JSON.stringify({ data: { repository: { pullRequests: { nodes } } } })} };
        if (a[0] === 'api' && a.includes('.default_branch')) return { rest: 'main' };
        if (a[0] === 'api') return { rest: '' };
        if (a[1] === 'edit') {
          if (a[2] === process.env.FAKE_EDIT_FAILS) throw new Error('edit refused');
          return { rest: '' };
        }
        return { rest: a.includes('merged') ? JSON.parse(process.env.FAKE_MERGED || '[]') : [] };
      }`,
    );
  });
  afterAll(() => worker.close());
  beforeEach(() => {
    resetHeads();
    fs.rmSync(path.join(ghDir, 'gh-calls.jsonl'), { force: true });
  });

  const repair = async (extra: Record<string, string> = {}) => {
    const r = await worker.run([], { cwd: fx.clone, env: { ...fake.env(fx.env), ...extra } });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };
  const edits = () =>
    fake
      .calls()
      .map((c) => c.args)
      .filter((a) => a[1] === 'edit');
  const releaseNext = () =>
    git(fx.origin, 'for-each-ref', '--format=%(objectname)', 'refs/heads/release/next');
  const merged = { FAKE_MERGED: '[{"number":1}]' };

  it('does nothing without a merged release PR', async () => {
    dropRef('refs/heads/release/next');
    expect(await repair()).toMatchObject({ status: 'none', retargeted: [] });
    expect(releaseNext()).toBe('');
    expect(edits()).toEqual([]);
  });

  it('recreates a missing release/next from main and retargets every moved PR', async () => {
    dropRef('refs/heads/release/next');
    expect(await repair(merged)).toMatchObject({
      status: 'done',
      branch: 'created',
      retargeted: [7, 8],
      failed: [],
    });
    expect(releaseNext()).toBe(git(fx.origin, 'rev-parse', 'main'));
    expect(edits()).toEqual([
      ['pr', 'edit', '7', '--base', 'release/next'],
      ['pr', 'edit', '8', '--base', 'release/next'],
    ]);
  });

  it('keeps an existing release/next and reports a failed retarget', async () => {
    const before = releaseNext();
    const r = await repair({ ...merged, FAKE_EDIT_FAILS: '7' });
    expect(r).toMatchObject({ status: 'failed', branch: 'present', retargeted: [8] });
    expect(r.failed).toEqual([{ number: 7, detail: 'edit refused' }]);
    expect(releaseNext()).toBe(before);
  });
});
