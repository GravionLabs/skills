import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv from 'ajv/dist/2020';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const script = path.join(root, 'skills/delivery/roadmap/scripts/Set-IssueMilestones.ps1');

// #255: the title lookup of Set-IssueMilestones.ps1 knows sub-numbers (M1.1) and keeps M1 and M1.1 apart.
const handler = `(call) => {
  const a = call.args;
  const p = a[1];
  if (a[0] === 'issue' && a[1] === 'edit') return { rest: {} };
  const m = /issues\\/(\\d+)$/.exec(p);
  if (m) return { rest: { number: Number(m[1]), milestone: null } };
  if (p.includes('/milestones?')) return { rest: [JSON.parse(process.env.FAKE_MILESTONES)] };
  if (p.includes('/tags?')) return { rest: [[]] };
  throw new Error('unexpected path ' + p);
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

describe('Set-IssueMilestones.ps1 sub-numbers', () => {
  it('assigns M1.1 to the exact sub-numbered milestone, M1 to the whole one', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-sub-'));
    const fake = createFakeGh(tmp, handler);
    const worker = new PwshWorker(script);
    try {
      const r = await worker.run(
        [
          '-Assignment',
          JSON.stringify([
            { issue: 1, milestone: 'M1.1' },
            { issue: 2, milestone: 'M1' },
          ]),
        ],
        {
          cwd: tmp,
          env: {
            ...fake.env(),
            FAKE_MILESTONES: JSON.stringify([ms(1, 'M1 Base'), ms(2, 'M1.1 Topic (0.2.0)')]),
          },
        },
      );
      expect(r.status).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.created).toEqual([]);
      expect(out.results.map((x: any) => x.milestone)).toEqual(['M1.1 Topic (0.2.0)', 'M1 Base']);
    } finally {
      worker.close();
    }
  });
});
