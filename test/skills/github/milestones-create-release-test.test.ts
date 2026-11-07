import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-milestone/scripts/Get-Milestones.ps1');

// #379: create and insert also make the release-test issue when .agents/config.json has release.test.
const handler = `(call) => {
  const a = call.args;
  if (a.includes('-X')) {
    if (a[3].endsWith('/issues')) return { rest: { number: 50, html_url: 'https://x/i/50' } };
    return { rest: { number: 9, title: a[a.indexOf('-f') + 1].replace('title=', ''), state: 'open', html_url: 'https://x/m/9' } };
  }
  if (a[1].includes('/milestones?')) return { rest: [JSON.parse(process.env.FAKE_MILESTONES || '[]')] };
  if (a[1].includes('labels=release-test')) return { rest: [JSON.parse(process.env.FAKE_EXISTING || '[]')] };
  if (a[1].includes('/issues?milestone=')) return { rest: [[]] };
  throw new Error('unexpected path ' + a[1]);
}`;

const ms = (number: number, title: string) => ({
  number,
  title,
  state: 'open',
  open_issues: 0,
  closed_issues: 0,
  due_on: null,
  html_url: `https://x/m/${number}`,
});

describe('Get-Milestones.ps1 create/insert release-test issue', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-rt-'));
    fake = createFakeGh(tmp, handler);
    fs.mkdirSync(path.join(tmp, '.github'));
    fs.writeFileSync(
      path.join(tmp, '.github/release-test.md'),
      'Test {milestone} on {platforms}.\n- [ ] smoke\n',
    );
  });
  afterAll(() => worker.close());

  const setConfig = (cfg: object | null) => {
    const f = path.join(tmp, '.agents/config.json');
    fs.rmSync(f, { force: true });
    if (cfg) {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(cfg));
    }
  };
  const withTest = {
    release: {
      test: { platforms: ['macOS', 'Linux', 'Windows'], template: '.github/release-test.md' },
    },
  };
  const run = async (args: string[], existing: object[] = []) => {
    const before = fake.calls().length;
    const r = await worker.run(args, {
      cwd: tmp,
      env: {
        ...fake.env(),
        FAKE_MILESTONES: JSON.stringify([ms(1, 'M1'), ms(2, 'M2')]),
        FAKE_EXISTING: JSON.stringify(existing),
      },
    });
    const issuePosts = fake
      .calls()
      .slice(before)
      .filter((c) => c.args.includes('-X') && c.args[3].endsWith('/issues'));
    return { r, issuePosts };
  };

  it('creates the issue with labels, milestone, body and tier line', async () => {
    setConfig(withTest);
    const { r, issuePosts } = await run(['-Mode', 'create']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).releaseTest).toEqual({
      created: true,
      number: 50,
      url: 'https://x/i/50',
    });
    expect(issuePosts).toHaveLength(1);
    const a = issuePosts[0].args;
    expect(a).toContain('title=[PBI] test: release candidate test of M3 on macOS, Linux, Windows');
    expect(a).toEqual(
      expect.arrayContaining([
        'labels[]=pbi',
        'labels[]=release-test',
        'labels[]=interactive',
        'milestone=9',
      ]),
    );
    const body = a.find((x) => x.startsWith('body='))!;
    expect(body).toContain('Test M3 on macOS, Linux, Windows.');
    expect(body).toContain('Tier: interactive');
  });

  it('creates nothing and prints no releaseTest without release.test', async () => {
    setConfig(null);
    const { r, issuePosts } = await run(['-Mode', 'create']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).not.toHaveProperty('releaseTest');
    expect(issuePosts).toHaveLength(0);
  });

  it('-NoReleaseTest skips it', async () => {
    setConfig(withTest);
    const { r, issuePosts } = await run(['-Mode', 'create', '-NoReleaseTest']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).not.toHaveProperty('releaseTest');
    expect(issuePosts).toHaveLength(0);
  });

  it('does not create a second release-test issue in the milestone', async () => {
    setConfig(withTest);
    const { r, issuePosts } = await run(
      ['-Mode', 'create'],
      [{ number: 7, html_url: 'https://x/i/7', labels: [{ name: 'release-test' }] }],
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).releaseTest).toEqual({
      created: false,
      number: 7,
      url: 'https://x/i/7',
    });
    expect(issuePosts).toHaveLength(0);
  });

  it('insert creates it too, and honours -NoReleaseTest', async () => {
    setConfig(withTest);
    const ins = await run(['-Mode', 'insert', '-Name', 'M2']);
    expect(ins.r.status).toBe(0);
    expect(JSON.parse(ins.r.stdout).releaseTest.created).toBe(true);
    expect(ins.issuePosts).toHaveLength(1);
    const skip = await run(['-Mode', 'insert', '-Name', 'M2', '-NoReleaseTest']);
    expect(JSON.parse(skip.r.stdout)).not.toHaveProperty('releaseTest');
    expect(skip.issuePosts).toHaveLength(0);
  });

  it('fails when the template file is missing', async () => {
    setConfig({ release: { test: { platforms: ['macOS'], template: 'nope.md' } } });
    const { r } = await run(['-Mode', 'create']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('nope.md');
  });
});
