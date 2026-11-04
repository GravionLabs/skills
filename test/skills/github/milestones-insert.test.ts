import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-milestone/scripts/Get-Milestones.ps1');

// #255: Get-Milestones.ps1 -Mode insert against a fake gh (GET answers from env, writes are recorded).
const handler = `(call) => {
  const a = call.args;
  if (a.includes('-X')) return { rest: { number: 99, title: a[a.indexOf('-f') + 1].replace('title=', ''), state: 'open', html_url: 'u' } };
  if (a[1].includes('/milestones?')) return { rest: [JSON.parse(process.env.FAKE_MILESTONES)] };
  if (a[1].includes('/issues?milestone=')) {
    const n = a[1].match(/milestone=(\\d+)/)[1];
    return { rest: [(JSON.parse(process.env.FAKE_ISSUES || '{}')[n]) || []] };
  }
  throw new Error('unexpected path ' + a[1]);
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

describe('Get-Milestones.ps1 -Mode insert', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-insert-'));
    fake = createFakeGh(tmp, handler);
  });
  afterAll(() => worker.close());

  const all = [
    ms(1, 'M1 (0.1.0)', 'closed'),
    ms(2, 'M2 Market'),
    ms(3, 'M3'),
    ms(4, 'M2.1'),
    ms(5, 'M4 Later (0.4.0)'),
  ];
  const insert = async (name: string, extra: string[] = [], list = all, issues: object = {}) => {
    const before = fake.calls().length;
    const r = await worker.run(['-Mode', 'insert', '-Name', name, ...extra], {
      cwd: tmp,
      env: {
        ...fake.env(),
        FAKE_MILESTONES: JSON.stringify(list),
        FAKE_ISSUES: JSON.stringify(issues),
      },
    });
    const writes = fake
      .calls()
      .slice(before)
      .filter((c) => c.args.includes('-X'))
      .map(
        (c) =>
          `${c.args[c.args.indexOf('-X') + 1]} ${c.args[c.args.indexOf('-X') + 2]} ${c.args[c.args.indexOf('-f') + 1]}`,
      );
    return { r, writes };
  };

  it('shifts open M<k> >= n from the highest down, keeps topic, version and sub-numbers, then creates M<n>', async () => {
    const { r, writes } = await insert('M2');
    expect(r.status).toBe(0);
    expect(writes).toEqual([
      'PATCH repos/{owner}/{repo}/milestones/5 title=M5 Later (0.4.0)',
      'PATCH repos/{owner}/{repo}/milestones/3 title=M4',
      'PATCH repos/{owner}/{repo}/milestones/4 title=M3.1',
      'PATCH repos/{owner}/{repo}/milestones/2 title=M3 Market',
      'POST repos/{owner}/{repo}/milestones title=M2',
    ]);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({
      inserted: true,
      dryRun: false,
      title: 'M2',
      milestone: { title: 'M2' },
    });
    expect(out.renames.map((x: any) => x.number)).toEqual([5, 3, 4, 2]);
  });

  it('never touches closed milestones', async () => {
    const { r, writes } = await insert('M2');
    expect(r.status).toBe(0);
    expect(writes.join('\n')).not.toContain('milestones/1 ');
  });

  it('dry run lists the renames and writes nothing', async () => {
    const { r, writes } = await insert('M3', ['-DryRun']);
    expect(writes).toEqual([]);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ inserted: false, dryRun: true });
    expect(out.renames.map((x: any) => `${x.from} -> ${x.to}`)).toEqual([
      'M4 Later (0.4.0) -> M5 Later (0.4.0)',
      'M3 -> M4',
    ]);
  });

  it('with nothing to shift it only creates M<n>', async () => {
    const { r, writes } = await insert('M9');
    expect(JSON.parse(r.stdout).renames).toEqual([]);
    expect(writes).toEqual(['POST repos/{owner}/{repo}/milestones title=M9']);
  });

  it('exits 1 before any write when the number is closed (nothing can come before M1 (0.1.0))', async () => {
    const { r, writes } = await insert('M1');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('collide');
    expect(writes).toEqual([]);
  });

  it('exits 1 before any write when a closed milestone sits at the target number', async () => {
    const { r, writes } = await insert('M2', [], [ms(1, 'M2'), ms(2, 'M3 (0.3.0)', 'closed')]);
    expect(r.status).toBe(1);
    expect(writes).toEqual([]);
  });

  it.each(['M2.1', '1.0.0', 'M0x'])('rejects the name %s', async (name) => {
    const { r, writes } = await insert(name);
    expect(r.status).toBe(1);
    expect(writes).toEqual([]);
  });

  it('reports references to the old names it cannot rewrite', async () => {
    const roadmap = path.join(tmp, 'ROADMAP.md');
    fs.writeFileSync(roadmap, '## M3\nwork\n');
    try {
      const { r } = await insert('M3', ['-DryRun'], all, {
        '3': [
          { number: 7, body: 'see M3 and M30' },
          { number: 8, body: 'M31 only' },
        ],
      });
      const refs = JSON.parse(r.stdout).references.map((x: any) => `${x.where}:${x.name}`);
      expect(refs).toEqual(['issue #7:M3', 'ROADMAP.md:M3']);
    } finally {
      fs.rmSync(roadmap);
    }
  });
});
