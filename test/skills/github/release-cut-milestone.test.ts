import * as fs from 'fs';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';
import { useReleaseFixture } from '../../helpers/release-fixture';

const skill = path.resolve(__dirname, '../../../skills/github/github-release');

const fx = useReleaseFixture();
const { git, dropRef, resetHeads } = fx;

// #1073: cut makes sure an open M<nnn> milestone exists for release/next (ADR 0010, decision 3).
const handler = `(call) => {
  const a = call.args;
  if (a.includes('-X')) {
    if (process.env.FAKE_CREATE_FAILS) throw new Error('HTTP 403');
    if (a[3].endsWith('/issues')) return { rest: { number: 50, html_url: 'https://x/i/50' } };
    return { rest: { number: 9, title: a[a.indexOf('-f') + 1].replace('title=', ''), state: 'open', html_url: 'https://x/m/9' } };
  }
  const p = a[1] || '';
  if (p.includes('/milestones?')) {
    if (process.env.FAKE_UNREADABLE) throw new Error('HTTP 502');
    const all = JSON.parse(process.env.FAKE_MILESTONES || '[]');
    return { rest: [p.includes('state=open') ? all.filter((m) => m.state === 'open') : all] };
  }
  if (p.includes('labels=release-test')) return { rest: [[]] };
  if (p === 'repos/{owner}/{repo}') return { rest: 'main' };
  return { rest: [] };
}`;

const ms = (title: string, state = 'open') => ({ number: 1, title, state });

let fake: ReturnType<typeof createFakeGh>;
beforeAll(() => {
  const ghDir = path.join(fx.tmp, 'fake-gh-milestone');
  fs.mkdirSync(ghDir);
  fake = createFakeGh(ghDir, handler);
});

const runner = (script: string) => {
  let worker: PwshWorker;
  beforeAll(() => {
    worker = new PwshWorker(path.join(skill, 'scripts', script));
  });
  afterAll(() => worker.close());
  return async (milestones: object[], args: string[] = [], env: NodeJS.ProcessEnv = {}) => {
    const before = fake.calls().length;
    const r = await worker.run(args, {
      cwd: fx.clone,
      env: { ...fake.env(fx.env), FAKE_MILESTONES: JSON.stringify(milestones), ...env },
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const posts = fake
      .calls()
      .slice(before)
      .filter((c) => c.args.includes('-X'));
    return { out: JSON.parse(r.stdout), posts };
  };
};

describe('Get-ReleaseState.ps1 openMilestone', () => {
  const run = runner('Get-ReleaseState.ps1');
  beforeAll(() => resetHeads());

  it.each([
    ['cut', [ms('M010'), ms('M002.1 Topic'), ms('1.0.0')], 'M002.1 Topic'],
    ['finish', [ms('M003')], 'M003'],
    ['cut', [ms('M001 (1.0.0)', 'closed'), ms('1.2.0'), ms('Backlog')], null],
  ])('%s reports the lowest open M<nnn> or null', async (mode, milestones, title) => {
    const { out, posts } = await run(milestones, ['-Mode', mode, '-Branch', 'release/next']);
    expect(out.openMilestone).toBe(title);
    expect(posts).toHaveLength(0);
  });

  it('is null when gh cannot read the milestones', async () => {
    const { out } = await run([ms('M003')], ['-Mode', 'cut'], { FAKE_UNREADABLE: '1' });
    expect(out.openMilestone).toBeNull();
  });
});

describe('New-ReleaseNext.ps1 (cut flow)', () => {
  const run = runner('New-ReleaseNext.ps1');
  const config = () => path.join(fx.clone, '.agents');
  beforeAll(() => {
    fs.mkdirSync(config(), { recursive: true });
    fs.writeFileSync(
      path.join(config(), 'config.json'),
      JSON.stringify({ release: { test: { platforms: ['Linux'], template: 'rc.md' } } }),
    );
    fs.writeFileSync(path.join(fx.clone, 'rc.md'), 'Test {milestone}.\n');
  });
  afterAll(() => {
    fs.rmSync(config(), { recursive: true, force: true });
    fs.rmSync(path.join(fx.clone, 'rc.md'));
  });
  beforeEach(() => {
    resetHeads();
    git(fx.origin, 'update-ref', 'refs/heads/release/next', 'main');
  });
  const closed = [ms('M003 (1.0.0)', 'closed')];

  it('creates the branch and the next milestone with its release test', async () => {
    dropRef('refs/heads/release/next');
    const { out, posts } = await run(closed);
    expect(out.status).toBe('created');
    expect(out.milestone).toEqual({
      status: 'created',
      title: 'M004',
      detail: 'created M004 for release/next',
      releaseTest: { created: true, number: 50, url: 'https://x/i/50' },
    });
    expect(posts).toHaveLength(2);
    expect(git(fx.origin, 'rev-parse', 'release/next')).toBe(git(fx.origin, 'rev-parse', 'main'));
  });

  it('-NoReleaseTest creates only the milestone, also when the branch is there', async () => {
    const { out, posts } = await run(closed, ['-NoReleaseTest']);
    expect(out.status).toBe('present');
    expect(out.milestone.detail).toBe('created M004 for release/next');
    expect(out.milestone).not.toHaveProperty('releaseTest');
    expect(posts).toHaveLength(1);
  });

  it('writes nothing when a milestone is open', async () => {
    const { out, posts } = await run([...closed, ms('M004')]);
    expect(out.milestone).toMatchObject({ status: 'present', title: 'M004' });
    expect(posts).toHaveLength(0);
  });

  it.each([
    ['unreadable milestones', { FAKE_UNREADABLE: '1' }, [], /cannot be read/, 0],
    ['a refused create', { FAKE_CREATE_FAILS: '1' }, [], /creating milestone M004 failed/, 1],
    ['no github-milestone', {}, ['-MilestoneScript', '/nope.ps1'], /not installed/, 0],
  ])('reports failed for %s', async (_case, env, args, detail, writes) => {
    const { out, posts } = await run(closed, args, env);
    expect(out.status).toBe('present');
    expect(out.milestone.status).toBe('failed');
    expect(out.milestone.detail).toMatch(detail);
    expect(posts).toHaveLength(writes);
  });
});

describe('github-release cut (SKILL.md)', () => {
  const text = () => fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8');

  it('ensures the milestone on cut and after the fast-forward of finish', () => {
    const [cut, finish] = text().split('## cut')[1].split('## finish');
    expect(cut).toContain('pwsh scripts/New-ReleaseNext.ps1');
    expect(cut).toContain('created M<nnn> for release/next');
    expect(cut).toContain('--no-release-test');
    expect(finish).toContain('pwsh scripts/New-ReleaseNext.ps1');
  });
});
