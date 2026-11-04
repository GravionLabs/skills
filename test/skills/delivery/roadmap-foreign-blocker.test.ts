import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv from 'ajv/dist/2020';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const skill = path.join(root, 'skills/delivery/roadmap');

// #272: a blocker from another repository keeps its repository (owner/repo#n), a local one stays an integer.
const handler = `(call) => {
  const [, p] = call.args;
  const m = /issues\\/(\\d+)\\/(parent|dependencies\\/blocked_by)$/.exec(p);
  if (m && m[2] === 'parent') throw new Error('404 Not Found');
  if (m) return { rest: JSON.parse(process.env.FAKE_BLOCKERS || '[]') };
  if (p.includes('/issues?')) return { rest: [JSON.parse(process.env.FAKE_ISSUES)] };
  if (p.includes('/milestones?')) return { rest: [[]] };
  if (p.includes('/tags?')) return { rest: [[]] };
  throw new Error('unexpected path ' + p);
}`;

const local = 'https://api.github.com/repos/o/r';
const poimen = 'https://api.github.com/repos/GravionLabs/poimen';
const blocker = (number: number, state: string, repo = local) => ({
  number,
  state,
  repository_url: repo,
});

describe('roadmap foreign blocker (#272)', () => {
  let tmp: string;
  let state: PwshWorker;
  let md: PwshWorker;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-foreign-'));
    state = new PwshWorker(path.join(skill, 'scripts/Get-RoadmapState.ps1'));
    md = new PwshWorker(path.join(skill, 'scripts/New-Roadmap.ps1'));
  });
  afterAll(async () => {
    await state.close();
    await md.close();
  });

  const getState = async (blockers: unknown[]) => {
    const fake = createFakeGh(tmp, handler);
    const r = await state.run([], {
      cwd: tmp,
      env: {
        ...fake.env(),
        FAKE_ISSUES: JSON.stringify([
          {
            number: 232,
            title: '[PBI] x',
            body: '',
            labels: [{ name: 'pbi' }],
            milestone: null,
            html_url: 'https://github.com/o/r/issues/232',
            repository_url: local,
          },
        ]),
        FAKE_BLOCKERS: JSON.stringify(blockers),
      },
    });
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };

  it('keeps owner/repo#n for a foreign blocker, plain integers for local ones, drops closed ones', async () => {
    const out = await getState([
      blocker(246, 'open', poimen),
      blocker(5, 'open'),
      blocker(6, 'closed', poimen),
      blocker(7, 'closed'),
    ]);
    expect(out.issues[0].blockedBy).toEqual(['GravionLabs/poimen#246', 5]);
    const schema = JSON.parse(
      fs.readFileSync(path.join(skill, 'schema/roadmap-state.schema.json'), 'utf8'),
    );
    const ajv = new Ajv({ strict: false });
    expect(ajv.validate(schema, out)).toBe(true);
    expect(ajv.validate(schema, { ...out, issues: [{ ...out.issues[0], blockedBy: ['x'] }] })).toBe(
      false,
    );
  });

  const issue = (number: number, extra: Record<string, unknown> = {}) => ({
    number,
    level: 'pbi',
    title: `[PBI] t${number}`,
    size: 'M',
    labels: ['pbi'],
    parent: null,
    blockedBy: [],
    milestone: null,
    url: null,
    ...extra,
  });

  it('renders a foreign blocker as owner/repo#n and keeps it out of the local plan order', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-foreign-md-'));
    const r = await md.run(
      [
        '-State',
        JSON.stringify({
          latestTag: null,
          issues: [
            issue(240, { milestone: 'M1', blockedBy: ['GravionLabs/poimen#250'] }),
            issue(232, { blockedBy: ['GravionLabs/poimen#246'] }),
            issue(250, { milestone: 'M1' }),
          ],
          milestones: [{ number: 1, title: 'M1', state: 'open', open: 2, closed: 0, progress: 0 }],
        }),
        '-Path',
        'ROADMAP.md',
        '-Date',
        '2026-11-04',
        '-Write',
      ],
      { cwd: dir },
    );
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const text = fs.readFileSync(path.join(dir, 'ROADMAP.md'), 'utf8').replace(/ {2,}/g, ' ');
    expect(text).toContain('| #232 | [PBI] t232 | blocked by GravionLabs/poimen#246 |');
    // #240 stays first: its blocker poimen#250 is not the local #250
    expect(text).toContain('| 1 | #240 | [PBI] t240 | M | blocked by GravionLabs/poimen#250 |');
    expect(text).toContain('| 2 | #250 |');
  });
});
