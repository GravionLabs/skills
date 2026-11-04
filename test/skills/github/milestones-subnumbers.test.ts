import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-milestone/scripts/Get-Milestones.ps1');

// #255: sub-numbers (M1.1) in sort order, lookup, current and create against a fake gh.
const handler = `(call) => {
  const a = call.args;
  if (a.includes('-X')) return { rest: { number: 99, title: a[a.indexOf('-f') + 1].replace('title=', ''), state: 'open', html_url: 'u' } };
  if (a[1].includes('/milestones?')) return { rest: [JSON.parse(process.env.FAKE_MILESTONES)] };
  if (a[1].includes('/tags')) return { rest: [[]] };
  if (a[1].includes('/issues')) return { rest: [[]] };
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

describe('Get-Milestones.ps1 sub-numbers', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-sub-'));
    fake = createFakeGh(tmp, handler);
  });
  afterAll(() => worker.close());

  const all = [
    ms(1, 'M10'),
    ms(2, 'M2'),
    ms(3, 'M1.2 Later'),
    ms(4, 'M1'),
    ms(5, 'M1.1 (0.2.0)', 'closed'),
    ms(6, 'M1.10'),
  ];
  const run = (args: string[], list = all) =>
    worker.run(args, { cwd: tmp, env: { ...fake.env(), FAKE_MILESTONES: JSON.stringify(list) } });

  it('lists numerically per part: 1, 1.1, 1.2, 1.10, 2, 10', async () => {
    const r = await run(['-Mode', 'list']);
    expect(r.status).toBe(0);
    const titles = JSON.parse(r.stdout).milestones.map((m: any) => m.title);
    expect(titles).toEqual(['M1', 'M1.1 (0.2.0)', 'M1.2 Later', 'M1.10', 'M2', 'M10']);
  });

  it('current is the lowest open one, a sub-number below the next whole number', async () => {
    const r = await run(
      ['-Mode', 'current'],
      [ms(1, 'M2'), ms(2, 'M1.5'), ms(3, 'M1.1', 'closed'), ms(4, 'M10')],
    );
    expect(JSON.parse(r.stdout).current.title).toBe('M1.5');
  });

  it.each([
    ['M1.1', 'M1.1 (0.2.0)'],
    ['M1.2', 'M1.2 Later'],
    ['M1.2 Later', 'M1.2 Later'],
    ['M1', 'M1'],
    ['0.2.0', 'M1.1 (0.2.0)'],
  ])('show %s finds %s exactly', async (name, title) => {
    const r = await run(['-Mode', 'show', '-Name', name]);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).title).toBe(title);
  });

  it('M1 does not match M1.1 and M1.1 does not match M1', async () => {
    expect((await run(['-Mode', 'show', '-Name', 'M1'], [ms(1, 'M1.1')])).status).toBe(1);
    expect((await run(['-Mode', 'show', '-Name', 'M1.1'], [ms(1, 'M1')])).status).toBe(1);
  });

  it('create M1.1 takes a free title and reports an existing one', async () => {
    const r = await run(['-Mode', 'create', '-Name', 'M1.1'], [ms(1, 'M1'), ms(2, 'M2')]);
    expect(JSON.parse(r.stdout)).toMatchObject({ created: true, milestone: { title: 'M1.1' } });
    const again = await run(['-Mode', 'create', '-Name', 'M1.1'], [ms(1, 'M1.1')]);
    expect(JSON.parse(again.stdout).created).toBe(false);
  });

  it('create without a name takes the next free whole number', async () => {
    const r = await run(['-Mode', 'create'], [ms(1, 'M1'), ms(2, 'M1.7'), ms(3, 'M2.3')]);
    expect(JSON.parse(r.stdout).milestone.title).toBe('M3');
  });

  it('rename keeps the number: M1.1 may take a topic and a version, not another number', async () => {
    const ok = await run(
      ['-Mode', 'rename', '-Name', 'M1.1', '-To', 'M1.1 Topic (0.2.0)'],
      [ms(1, 'M1.1')],
    );
    expect(JSON.parse(ok.stdout).renamed).toBe(true);
    const bad = await run(['-Mode', 'rename', '-Name', 'M1.1', '-To', 'M1.2'], [ms(1, 'M1.1')]);
    expect(bad.status).toBe(1);
  });

  it('rejects malformed sub-numbers on create', async () => {
    expect((await run(['-Mode', 'create', '-Name', 'M1..1'], [])).status).toBe(1);
    expect((await run(['-Mode', 'create', '-Name', 'M1.'], [])).status).toBe(1);
  });
});
