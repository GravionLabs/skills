import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-milestone/scripts/Get-Milestones.ps1');

// #249: milestone titles with a topic (M<n> <Topic> [(x.y.z)]) against a fake gh.
const handler = `(call) => {
  const env = (k, d) => JSON.parse(process.env[k] || d);
  const a = call.args;
  if (a.includes('-X')) {
    const title = (a.find((x) => x.startsWith('title=')) || 'title=').slice(6);
    return { rest: { number: 99, title, state: a.includes('state=closed') ? 'closed' : 'open', html_url: 'https://x/m/99' } };
  }
  const p = a[1];
  if (p.includes('/git/ref/tags/')) {
    if (!env('FAKE_TAGS', '[]').includes(p.split('/git/ref/tags/')[1])) throw new Error('Not Found (HTTP 404)');
    return { rest: {} };
  }
  if (p.includes('/tags?')) return { rest: [env('FAKE_TAGS', '[]').map((name) => ({ name }))] };
  if (p.includes('/milestones?')) return { rest: [env('FAKE_MILESTONES', '[]')] };
  if (p.includes('/issues?')) return { rest: [[]] };
  throw new Error('unexpected path ' + p);
}`;

const ms = (number: number, title: string, state = 'open') => ({
  number,
  title,
  state,
  open_issues: 0,
  closed_issues: 0,
  due_on: null,
  html_url: `https://x/m/${number}`,
});

describe('Get-Milestones.ps1 with a milestone topic', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-topic-'));
    fake = createFakeGh(tmp, handler);
  });
  afterAll(() => worker.close());

  const run = async (args: string[], milestones: unknown[], tags: string[] = []) => {
    const before = fake.calls().length;
    const r = await worker.run(args, {
      cwd: tmp,
      env: {
        ...fake.env(),
        FAKE_MILESTONES: JSON.stringify(milestones),
        FAKE_TAGS: JSON.stringify(tags),
      },
    });
    const writes = fake
      .calls()
      .slice(before)
      .filter((c) => c.args.includes('-X'))
      .map((c) => c.args);
    return { r, writes, out: r.status === 0 ? JSON.parse(r.stdout) : null };
  };

  const all = [
    ms(1, 'M10 Late'),
    ms(2, 'M3 Market data'),
    ms(3, 'M2 Core (0.1.0)', 'closed'),
    ms(4, 'M4 (bad topic)'),
    ms(5, 'M5 Topic (x)'),
    ms(6, 'topic only'),
  ];

  it('lists valid titles by number and the invalid ones last; current is the lowest open M<n>', async () => {
    const list = await run(['-Mode', 'list'], all, ['v0.1.0']);
    expect(list.out.milestones.slice(0, 3).map((m: { title: string }) => m.title)).toEqual([
      'M2 Core (0.1.0)',
      'M3 Market data',
      'M10 Late',
    ]);
    expect(list.out.milestones).toHaveLength(6);
    expect(list.out.milestones[0].tagged).toBe(true);
    const cur = await run(['-Mode', 'current'], all, ['v0.1.0']);
    expect(cur.out.current.title).toBe('M3 Market data');
  });

  it('invalid titles alone are never current', async () => {
    const cur = await run(['-Mode', 'current'], [ms(4, 'M4 (bad topic)'), ms(6, 'topic only')]);
    expect(cur.out.current).toBeNull();
  });

  it.each([
    ['M3 Market data', 2],
    ['M3', 2],
    ['M2', 3],
    ['M2 Core', 3],
    ['0.1.0', 3],
    ['v0.1.0', 3],
    ['M2 Core (0.1.0)', 3],
  ])('show -Name %s finds milestone %i', async (name, number) => {
    const { out } = await run(['-Mode', 'show', '-Name', name], all);
    expect(out.number).toBe(number);
  });

  it('show of an unknown name is exit 1', async () => {
    const { r } = await run(['-Mode', 'show', '-Name', 'M7'], all);
    expect(r.status).toBe(1);
  });

  it.each([
    ['M3', 'M003 Market data (0.2.0)'],
    ['M3 Market data', 'M003 Market data (0.2.0)'],
  ])('close %s adds the version at the end', async (name, title) => {
    const { out, writes } = await run(['-Mode', 'close', '-Name', name, '-Version', '0.2.0'], all, [
      'v0.2.0',
    ]);
    expect(out).toMatchObject({ closed: true, version: '0.2.0', milestone: { title } });
    expect(writes).toEqual([
      [
        'api',
        '-X',
        'PATCH',
        'repos/{owner}/{repo}/milestones/2',
        '-f',
        'state=closed',
        '-f',
        `title=${title}`,
      ],
    ]);
  });

  it('close -MoveTo resolves a target with a topic and validates it first', async () => {
    const { out } = await run(
      ['-Mode', 'close', '-Name', 'M3', '-MoveTo', 'M10', '-Version', '0.2.0'],
      all,
      ['v0.2.0'],
    );
    expect(out.closed).toBe(true);
    const bad = await run(['-Mode', 'close', '-Name', 'M3', '-MoveTo', 'M11'], all, ['v0.2.0']);
    expect(bad.r.status).toBe(1);
    expect(bad.writes).toEqual([]);
  });

  it('create accepts a topic, finds an existing one by number, rejects a version and bad names', async () => {
    const made = await run(['-Mode', 'create', '-Name', 'M11 Billing'], all);
    expect(made.out).toMatchObject({ created: true, milestone: { title: 'M011 Billing' } });
    const again = await run(['-Mode', 'create', '-Name', 'M3 Other'], all);
    expect(again.out).toMatchObject({ created: false, milestone: { number: 2 } });
    for (const name of ['M3 (0.2.0)', 'M3 Topic (0.2.0)', 'M3 (x)']) {
      const bad = await run(['-Mode', 'create', '-Name', name], all);
      expect(bad.r.status).toBe(1);
    }
    const next = await run(['-Mode', 'create'], all);
    expect(next.out.milestone.title).toBe('M011');
  });
});
