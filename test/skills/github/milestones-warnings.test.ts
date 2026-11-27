import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv2020 from 'ajv/dist/2020';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const skill = path.join(root, 'skills/github/github-milestone');

// #327: the `warnings` group of current/show (milestone rule: Epic never).
const handler = `(call) => {
  const env = (k, d) => JSON.parse(process.env[k] || d);
  const p = call.args[1];
  let page;
  if (p.includes('/milestones?')) page = env('FAKE_MILESTONES', '[]');
  else if (p.includes('/tags?')) page = [];
  else if (p.includes('/sub_issues')) page = env('FAKE_SUBS', '{}')[/issues\\/(\\d+)\\//.exec(p)[1]] || [];
  else if (p.includes('/issues?')) page = env('FAKE_ISSUES', '[]');
  else if (p.includes('/dependencies/blocked_by')) page = [];
  else throw new Error('unexpected path ' + p);
  return { rest: [page] };
}`;

const m4 = {
  number: 4,
  title: 'M4',
  state: 'open',
  open_issues: 3,
  closed_issues: 0,
  due_on: null,
  html_url: 'https://x/m/4',
};
const issue = (number: number, label: string) => ({
  number,
  title: `issue ${number}`,
  labels: [{ name: label }],
  assignees: [],
  repository_url: 'https://api.github.com/repos/o/r',
});
const sub = (number: number, milestone: { number: number; title: string } | null) => ({
  ...issue(number, 'pbi'),
  state: 'open',
  milestone,
});

describe('Get-Milestones.ps1 warnings (#327)', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(path.join(skill, 'scripts/Get-Milestones.ps1'));
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-warn-'));
    fake = createFakeGh(tmp, handler);
  });
  afterAll(() => worker.close());

  const show = async (issues: unknown[], subs: Record<number, unknown[]> = {}) => {
    const r = await worker.run(['-Mode', 'show', '-Name', 'M4'], {
      cwd: tmp,
      env: {
        ...fake.env(),
        FAKE_MILESTONES: JSON.stringify([m4]),
        FAKE_ISSUES: JSON.stringify(issues),
        FAKE_SUBS: JSON.stringify(subs),
      },
    });
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };

  it('has no warnings for PBIs, and for a Feature whose open PBIs are elsewhere (ADR 0010)', async () => {
    const out = await show([issue(1, 'pbi'), issue(2, 'feature')], {
      2: [sub(5, { number: 9, title: 'M5' }), sub(6, null)],
    });
    expect(out.warnings).toEqual([]);
  });

  it('warns about an Epic in the milestone', async () => {
    const out = await show([issue(7, 'epic')]);
    expect(out.warnings).toEqual([{ type: 'epic-in-milestone', number: 7, title: 'issue 7' }]);
  });

  it('counts the open PBIs and Bugs below a Feature in the groups, marked via', async () => {
    const same = 'https://api.github.com/repos/o/r';
    const below = (number: number, label: string, extra: object = {}) => ({
      ...issue(number, label),
      state: 'open',
      ...extra,
    });
    const out = await show([issue(2, 'feature'), issue(4, 'pbi')], {
      2: [
        below(3, 'pbi'),
        below(4, 'pbi'),
        below(5, 'bug', { assignees: [{ login: 'jk' }], repository_url: same }),
        below(6, 'pbi', { state: 'closed' }),
        below(8, 'pbi', { repository_url: 'https://api.github.com/repos/o/other' }),
        below(9, 'task'),
      ],
    });
    expect(out.issues.ready).toEqual([
      { number: 2, title: 'issue 2', assignees: [] },
      { number: 3, title: 'issue 3', assignees: [], via: 2 },
      { number: 4, title: 'issue 4', assignees: [] },
    ]);
    expect(out.issues.claimed).toEqual([
      { number: 5, title: 'issue 5', assignees: ['jk'], via: 2 },
    ]);
    expect(out.shipped).toEqual([]);
  });

  it('shipped lists the closed PBIs and Bugs of the milestone, not other closed issues', async () => {
    const closed = (number: number, label: string) => ({
      ...issue(number, label),
      state: 'closed',
    });
    const out = await show([
      closed(1, 'pbi'),
      closed(2, 'feature'),
      closed(3, 'bug'),
      issue(4, 'pbi'),
    ]);
    expect(out.shipped.map((i: { number: number }) => i.number)).toEqual([1, 3]);
    expect(out.issues.ready.map((i: { number: number }) => i.number)).toEqual([4]);
    expect(out.warnings).toEqual([]);
  });

  it('the output matches the schema', async () => {
    const out = await show(
      [issue(7, 'epic'), issue(2, 'feature'), { ...issue(1, 'pbi'), state: 'closed' }],
      {
        2: [{ ...issue(6, 'pbi'), state: 'open' }],
      },
    );
    const schema = JSON.parse(
      fs.readFileSync(path.join(skill, 'schema/milestones.schema.json'), 'utf8'),
    );
    const ajv = new Ajv2020({ strict: false });
    expect(ajv.validate(schema, out)).toBe(true);
  });
});
