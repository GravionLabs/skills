import Ajv2020 from 'ajv/dist/2020';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

// #538: Get-ObjectiveStatus.ps1 against a fake gh. The PBI names Pester; this repository tests its scripts with Vitest
// (AGENTS.md), so the mocked gh responses come from FAKE_GH (path -> JSON), like the other deliver and milestone tests.
const skillDir = path.resolve(__dirname, '../../../skills/delivery/deliver');
const script = path.join(skillDir, 'scripts/Get-ObjectiveStatus.ps1');
const schema = JSON.parse(
  fs.readFileSync(path.join(skillDir, 'schema/objective-status.schema.json'), 'utf8'),
);

// GET only: any write flag fails the call; lists (--paginate --slurp) answer one page; unknown lists are empty
const handler = `(call) => {
  const a = call.args;
  if (a[0] !== 'api') throw new Error('unexpected gh ' + a.join(' '));
  if (a.some((x) => ['-X', '--method', '-f', '-F', '--field', '--raw-field', '--input'].includes(x))) throw new Error('write: ' + a.join(' '));
  const p = a[1];
  const data = JSON.parse(process.env.FAKE_GH || '{}');
  const bare = p.split('?')[0];
  let v = p in data ? data[p] : data[bare];
  if (v === undefined) {
    if (/\\/(sub_issues|comments|blocked_by|pulls|milestones|issues)$/.test(bare)) v = [];
    else if (/^repos\\/[^/]+\\/[^/]+$/.test(bare)) v = { default_branch: 'main' };
    else throw new Error('404 Not Found ' + p);
  }
  return { rest: a.includes('--paginate') ? [v] : v };
}`;

type Iss = {
  number: number;
  state?: 'open' | 'closed';
  labels?: string[];
  body?: string;
  title?: string;
  blocked?: number;
};
const issue = (repo: string, i: Iss) => ({
  number: i.number,
  title: i.title ?? `T${i.number}`,
  state: i.state ?? 'open',
  body: i.body ?? '',
  labels: (i.labels ?? ['pbi']).map((name) => ({ name })),
  repository_url: `https://api.github.com/repos/${repo}`,
  issue_dependencies_summary: { blocked_by: i.blocked ?? 0 },
});
const feature = (repo: string, number: number, body = '') =>
  issue(repo, { number, labels: ['feature'], body });
const ms = (number: number, title: string, state = 'open') => ({ number, title, state });

const objectiveBody = [
  '## Outcome',
  'x',
  '## Affected repos',
  '- o/a',
  '- o/b',
  '- o/c',
  '## Acceptance Criteria',
  '- [x] one',
  '- [ ] two',
].join('\n');

// chain o/a <- o/b <- o/c: o/b requires an rc of o/a@M1, o/c requires o/b@M2 released
function chain(over: Record<string, unknown> = {}) {
  return {
    'repos/o/telos/issues/1': {
      number: 1,
      title: '[Objective] Chain',
      state: 'open',
      body: objectiveBody,
    },
    'repos/o/telos/issues/1/sub_issues': [
      feature('o/a', 10),
      feature('o/b', 20, 'Requires: o/a@M1 rc'),
      feature('o/c', 30, '- Requires: o/b@M2 released'),
    ],
    'repos/o/a/issues/10/sub_issues': [
      issue('o/a', { number: 11, state: 'closed' }),
      issue('o/a', { number: 12 }),
    ],
    'repos/o/b/issues/20/sub_issues': [issue('o/b', { number: 21 })],
    'repos/o/c/issues/30/sub_issues': [issue('o/c', { number: 31 })],
    'repos/o/a/milestones': [ms(1, 'M001 Core')],
    'repos/o/b/milestones': [ms(2, 'M002')],
    'repos/o/a/issues': [issue('o/a', { number: 13, labels: ['pbi', 'release-test'] })],
    'repos/o/a/issues/13/comments': [{ body: '<!-- release-test-rc -->\nRC v1.0.0-rc.1' }],
    ...over,
  };
}

describe('Get-ObjectiveStatus.ps1', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  const ajv = new Ajv2020({ strict: false });
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'objective-status-'));
    fake = createFakeGh(tmp, handler);
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const status = async (data: Record<string, unknown>, objective = 'o/telos#1') => {
    const before = fake.calls().length;
    const r = await worker.run(['-Objective', objective, '-Json'], {
      cwd: tmp,
      env: { ...fake.env(), FAKE_GH: JSON.stringify(data) },
    });
    const calls = fake.calls().slice(before);
    return { r, calls, out: r.status === 0 ? JSON.parse(r.stdout) : null };
  };
  const byRepo = (out: any) =>
    Object.fromEntries(out.repos.map((x: any) => [x.repository, x.status]));

  it('chain across three repos: met rc edge ready, unmet released edge waiting; reads only', async () => {
    const { r, out, calls } = await status(chain());
    expect(r.stderr).toBe('');
    expect(byRepo(out)).toEqual({
      'o/a': 'ready',
      'o/b': 'ready',
      'o/c': 'waiting(requires o/b@M2 released)',
    });
    expect(out.repos[0]).toMatchObject({
      open: 1,
      closed: 1,
      ready: [{ number: 12, url: 'https://github.com/o/a/issues/12' }],
    });
    expect(out.requires).toEqual([
      expect.objectContaining({
        repository: 'o/a',
        milestone: 'M1',
        kind: 'rc',
        source: 'o/b#20',
        appliesTo: 'o/b',
        met: true,
        releaseTest: 'https://github.com/o/a/issues/13',
      }),
      expect.objectContaining({
        repository: 'o/b',
        milestone: 'M2',
        kind: 'released',
        source: 'o/c#30',
        appliesTo: 'o/c',
        met: false,
        milestoneState: 'open',
      }),
    ]);
    expect(out.gates).toEqual([
      {
        type: 'not-released',
        repository: 'o/b',
        detail: 'o/b@M2 released (milestone open)',
        url: null,
      },
      {
        type: 'acceptance-criteria',
        repository: 'o/telos',
        detail: '1 open',
        url: 'https://github.com/o/telos/issues/1',
      },
    ]);
    expect(ajv.validate(schema, out)).toBe(true);
    // invariant: only GET calls via gh api, every list paginated
    expect(calls.every((c) => c.args[0] === 'api' && !c.args.includes('-X'))).toBe(true);
    expect(
      calls
        .filter((c) => c.args[1].includes('sub_issues'))
        .every((c) => c.args.includes('--paginate')),
    ).toBe(true);
  });

  it('unmet rc edge (no marker on the release-test issue): waiting(requires … rc) and an rc-missing gate', async () => {
    const { out } = await status(chain({ 'repos/o/a/issues/13/comments': [{ body: 'not yet' }] }));
    expect(byRepo(out)['o/b']).toBe('waiting(requires o/a@M1 rc)');
    expect(out.gates).toContainEqual({
      type: 'rc-missing',
      repository: 'o/a',
      detail: 'o/a@M1 rc (milestone open)',
      url: 'https://github.com/o/a/issues/13',
    });
  });

  it('a closed required milestone meets released and rc', async () => {
    const { out } = await status(
      chain({
        'repos/o/b/milestones': [ms(2, 'M002 (1.1.0)', 'closed')],
        'repos/o/a/issues/13/comments': [],
        'repos/o/a/milestones': [ms(1, 'M001 Core (1.0.0)', 'closed')],
      }),
    );
    expect(byRepo(out)).toEqual({ 'o/a': 'ready', 'o/b': 'ready', 'o/c': 'ready' });
  });

  it('a foreign open blocker keeps its repository; closed blockers and labels decide the rest', async () => {
    const { out } = await status(
      chain({
        'repos/o/b/issues/20/sub_issues': [
          issue('o/b', { number: 21, blocked: 2 }),
          issue('o/b', { number: 22, labels: ['pbi', 'needs-decision'] }),
        ],
        'repos/o/b/issues/21/dependencies/blocked_by': [
          { number: 9, state: 'open', repository_url: 'https://api.github.com/repos/o/z' },
          { number: 8, state: 'closed', repository_url: 'https://api.github.com/repos/o/z' },
        ],
      }),
    );
    expect(byRepo(out)['o/b']).toBe('waiting(o/b#21 blocked by o/z#9; o/b#22 needs-decision)');
  });

  it('everything done: all PBIs closed, release PR gate, no open criteria', async () => {
    const closed = (repo: string, n: number) => [issue(repo, { number: n, state: 'closed' })];
    const { out } = await status({
      'repos/o/telos/issues/1': {
        number: 1,
        title: '[Objective] Done',
        state: 'open',
        body: '## Acceptance Criteria\n- [x] all\n',
      },
      'repos/o/telos/issues/1/sub_issues': [
        feature('o/a', 10),
        feature('o/b', 20),
        feature('o/c', 30),
      ],
      'repos/o/a/issues/10/sub_issues': closed('o/a', 11),
      'repos/o/b/issues/20/sub_issues': closed('o/b', 21),
      'repos/o/c/issues/30/sub_issues': closed('o/c', 31),
      'repos/o/c/pulls': [{ html_url: 'https://github.com/o/c/pull/5' }],
    });
    expect(byRepo(out)).toEqual({ 'o/a': 'done', 'o/b': 'done', 'o/c': 'done' });
    expect(out.gates).toEqual([
      {
        type: 'release-pr',
        repository: 'o/c',
        detail: 'release/next into main open',
        url: 'https://github.com/o/c/pull/5',
      },
    ]);
    expect(ajv.validate(schema, out)).toBe(true);
  });

  it('a Requires line of the objective gates every repo but the required one; an affected repo without children waits', async () => {
    const { out } = await status({
      'repos/o/telos/issues/1': {
        number: 1,
        title: 'O',
        state: 'open',
        body: 'Requires: o/a@M1 rc\n## Affected repos\n- o/d\n',
      },
      'repos/o/telos/issues/1/sub_issues': [feature('o/a', 10), feature('o/b', 20)],
      'repos/o/a/issues/10/sub_issues': [issue('o/a', { number: 11 })],
      'repos/o/b/issues/20/sub_issues': [issue('o/b', { number: 21 })],
      'repos/o/a/milestones': [ms(1, 'M001')],
    });
    expect(byRepo(out)).toEqual({
      'o/a': 'ready',
      'o/b': 'waiting(requires o/a@M1 rc)',
      'o/d': 'waiting(requires o/a@M1 rc)',
    });
    expect(out.gates).toContainEqual({
      type: 'rc-missing',
      repository: 'o/a',
      detail: 'o/a@M1 rc (milestone open)',
      url: null,
    });
  });

  it.each([
    ['a malformed -Objective', 'telos#1', /must be <owner>\/<repo>#<nr>/],
    ['an unreadable objective', 'o/telos#2', /gh api repos\/o\/telos\/issues\/2 failed/],
  ])('fails on %s', async (_n, objective, msg) => {
    const { r } = await status(chain(), objective);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(msg);
  });
});
