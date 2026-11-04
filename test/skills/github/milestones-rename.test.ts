import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-milestone/scripts/Get-Milestones.ps1');

// #242: Get-Milestones.ps1 -Mode rename against a fake gh (GET answers from FAKE_MILESTONES, writes are recorded).
const handler = `(call) => {
  const a = call.args;
  if (a.includes('-X')) return { rest: {} };
  if (a[1].includes('/milestones?')) return { rest: [JSON.parse(process.env.FAKE_MILESTONES)] };
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

describe('Get-Milestones.ps1 -Mode rename', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-rename-'));
    fake = createFakeGh(tmp, handler);
  });
  afterAll(() => worker.close());

  const all = [
    ms(1, '0.1.0'),
    ms(2, '0.2.0'),
    ms(3, 'M3 Market'),
    ms(4, 'M4'),
    ms(5, 'M5 (0.5.0)', 'closed'),
  ];
  const rename = async (name: string, to: string) => {
    const before = fake.calls().length;
    const r = await worker.run(['-Mode', 'rename', '-Name', name, '-To', to], {
      cwd: tmp,
      env: { ...fake.env(), FAKE_MILESTONES: JSON.stringify(all) },
    });
    const writes = fake
      .calls()
      .slice(before)
      .filter((c) => c.args.includes('-X'))
      .map((c) => c.args);
    return { r, writes };
  };

  it.each([
    ['0.1.0', 'M1 (0.1.0)', 1],
    ['0.2.0', 'M2 (0.1.1)', 2],
    ['v0.2.0', 'M2 (0.1.1)', 2],
    ['M3', 'M3 Market data', 3],
    ['M4', 'M4 Core', 4],
  ])('%s -> %s: one PATCH of the title only', async (name, to, number) => {
    const { r, writes } = await rename(name, to);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      renamed: true,
      milestone: { number, title: to, state: 'open' },
    });
    expect(writes).toEqual([
      ['api', '-X', 'PATCH', `repos/{owner}/{repo}/milestones/${number}`, '-f', `title=${to}`],
    ]);
  });

  it.each([
    ['unknown name', 'M9', 'M9 X', /not found/],
    ['closed milestone', 'M5', 'M5 Renamed', /closed/],
    ['existing target title', '0.1.0', 'M4', /already exists/],
    ['M<n> number already used by another milestone', '0.1.0', 'M3', /already exists/],
    ['invalid target', '0.1.0', 'next', /invalid -To/],
    ['legacy target', '0.1.0', '0.9.0', /invalid -To/],
    ['changed number of an M<n>', 'M4', 'M8 (0.4.0)', /stays M4/],
  ])('%s: exit 1, nothing written', async (_c, name, to, msg) => {
    const { r, writes } = await rename(name, to);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(msg);
    expect(writes).toEqual([]);
  });
});
