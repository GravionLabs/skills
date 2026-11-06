import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv2020 from 'ajv/dist/2020';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const skill = path.join(root, 'skills/github/github-milestone');

// #327: the `warnings` group of current/show (milestone rule: Epic never, Feature only when all its PBIs are in it).
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
const sub = (
  number: number,
  milestone: { number: number; title: string } | null,
  state = 'open',
) => ({ number, title: `sub ${number}`, state, milestone });

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

  it('has no warnings for PBIs, and for a Feature whose open PBIs are all in the milestone', async () => {
    const out = await show([issue(1, 'pbi'), issue(2, 'feature')], {
      2: [sub(3, { number: 4, title: 'M4' }), sub(5, { number: 9, title: 'M9' }, 'closed')],
    });
    expect(out.warnings).toEqual([]);
  });

  it('warns about an Epic in the milestone', async () => {
    const out = await show([issue(7, 'epic')]);
    expect(out.warnings).toEqual([{ type: 'epic-in-milestone', number: 7, title: 'issue 7' }]);
  });

  it('warns about a Feature with open sub-issues outside, with their milestone or none', async () => {
    const out = await show([issue(2, 'feature')], {
      2: [sub(3, { number: 4, title: 'M4' }), sub(5, { number: 9, title: 'M5' }), sub(6, null)],
    });
    expect(out.warnings).toEqual([
      {
        type: 'feature-incomplete',
        number: 2,
        title: 'issue 2',
        outside: [
          { number: 5, title: 'sub 5', milestone: 'M5' },
          { number: 6, title: 'sub 6', milestone: 'none' },
        ],
      },
    ]);
  });

  it('the output matches the schema', async () => {
    const out = await show([issue(7, 'epic'), issue(2, 'feature')], { 2: [sub(6, null)] });
    const schema = JSON.parse(
      fs.readFileSync(path.join(skill, 'schema/milestones.schema.json'), 'utf8'),
    );
    const ajv = new Ajv2020({ strict: false });
    expect(ajv.validate(schema, out)).toBe(true);
  });
});
