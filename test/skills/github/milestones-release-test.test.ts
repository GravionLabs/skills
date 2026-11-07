import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/github/github-milestone/scripts/Get-Milestones.ps1');

// #377: rcPosted of a release-test issue = the marker <!-- release-test-rc --> in one of its comments.
const handler = `(call) => {
  const env = (k, d) => JSON.parse(process.env[k] || d);
  const p = call.args[1];
  if (p.includes('/milestones?')) return { rest: [env('FAKE_MILESTONES', '[]')] };
  if (p.includes('/tags?')) return { rest: [[]] };
  if (p.includes('/issues?')) return { rest: [env('FAKE_ISSUES', '[]')] };
  if (p.includes('/dependencies/blocked_by')) return { rest: [[]] };
  if (p.includes('/comments')) {
    if (process.env.FAKE_COMMENTS_FAIL) throw new Error('comments unavailable');
    return { rest: env('FAKE_COMMENTS', '[]') };
  }
  throw new Error('unexpected path ' + p);
}`;

const m4 = {
  number: 4,
  title: 'M4',
  state: 'open',
  open_issues: 2,
  closed_issues: 0,
  due_on: null,
  html_url: 'https://x/m/4',
};
const repo = 'https://api.github.com/repos/o/r';
const issues = [
  {
    number: 1,
    title: 'a pbi',
    state: 'open',
    labels: [{ name: 'pbi' }],
    assignees: [],
    repository_url: repo,
  },
  {
    number: 2,
    title: 'RC test',
    state: 'open',
    labels: [{ name: 'pbi' }, { name: 'release-test' }],
    assignees: [],
    repository_url: repo,
  },
];

describe('Get-Milestones.ps1 rcPosted of a release-test issue (#377)', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'milestones-rc-'));
    fake = createFakeGh(tmp, handler);
  });
  afterAll(() => worker.close());

  const read = async (extra: Record<string, string>) => {
    const r = await worker.run(['-Mode', 'issues', '-Name', 'M4', '-State', 'open'], {
      cwd: tmp,
      env: {
        ...fake.env(),
        FAKE_MILESTONES: JSON.stringify([m4]),
        FAKE_ISSUES: JSON.stringify(issues),
        ...extra,
      },
    });
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout).issues as { number: number; rcPosted?: boolean }[];
  };

  it('is true when a comment carries the marker, and only set on the release-test issue', async () => {
    const out = await read({
      FAKE_COMMENTS: JSON.stringify(['hello', 'RC v1\n<!-- release-test-rc -->']),
    });
    expect(out.find((i) => i.number === 2)?.rcPosted).toBe(true);
    expect(out.find((i) => i.number === 1)?.rcPosted).toBeUndefined();
  });

  it('is false without the marker', async () => {
    const out = await read({ FAKE_COMMENTS: JSON.stringify(['hello', 'no marker here']) });
    expect(out.find((i) => i.number === 2)?.rcPosted).toBe(false);
  });

  it('is false when the comment read fails', async () => {
    const out = await read({ FAKE_COMMENTS_FAIL: '1' });
    expect(out.find((i) => i.number === 2)?.rcPosted).toBe(false);
  });
});
