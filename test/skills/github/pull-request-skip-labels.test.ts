import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const skillDir = path.join(root, 'skills/github/github-pull-request');
const script = path.join(skillDir, 'scripts/Add-SkipLabels.ps1');

// #136: the skip labels of the issue are copied onto the PR; a GET of repos/../labels/<name> checks existence
const handler = `(call) => {
  const [, p] = call.args;
  if (call.args.includes('POST')) return { rest: [] };
  const name = decodeURIComponent(p.split('/labels/')[1]);
  if (!JSON.parse(process.env.FAKE_LABELS || '[]').includes(name)) throw new Error('404');
  return { rest: { name } };
}`;

describe('Add-SkipLabels.ps1', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'skiplabels-'));
    fake = createFakeGh(tmp, handler);
  });
  afterAll(() => worker.close());

  const run = async (config: unknown, issueLabels: string[], repoLabels: string[]) => {
    const cfg = path.join(tmp, 'config.json');
    fs.rmSync(cfg, { force: true });
    if (config !== undefined) fs.writeFileSync(cfg, JSON.stringify(config));
    fs.rmSync(path.join(tmp, 'gh-calls.jsonl'), { force: true });
    const r = await worker.run(
      ['-Pr', '7', '-IssueLabel', issueLabels.join(','), '-Config', cfg, '-Repo', 'o/r'],
      { cwd: tmp, env: { ...fake.env(), FAKE_LABELS: JSON.stringify(repoLabels) } },
    );
    return { r, posts: fake.calls().filter((c) => c.args.includes('POST')) };
  };

  it('adds skip-adr by default when the governance key exists', async () => {
    const { r, posts } = await run({ governance: {} }, ['skip-adr', 'bug'], ['skip-adr', 'bug']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ added: ['skip-adr'], missing: [] });
    expect(posts).toHaveLength(1);
    expect(posts[0].args).toEqual([
      'api',
      '-X',
      'POST',
      'repos/o/r/issues/7/labels',
      '-f',
      'labels[]=skip-adr',
    ]);
  });

  it('adds only the labels of a custom skipLabels', async () => {
    const all = ['skip-adr', 'no-adr', 'waived'];
    const { r, posts } = await run({ governance: { skipLabels: ['no-adr', 'waived'] } }, all, all);
    expect(JSON.parse(r.stdout)).toEqual({ added: ['no-adr', 'waived'], missing: [] });
    expect(posts[0].args).toContain('labels[]=waived');
    expect(posts[0].args).not.toContain('labels[]=skip-adr');
  });

  it.each([
    { case: 'no governance key', config: { other: 1 } },
    { case: 'no config file', config: undefined },
  ])('does nothing with $case', async ({ config }) => {
    const { r, posts } = await run(config, ['skip-adr'], ['skip-adr']);
    expect(JSON.parse(r.stdout)).toEqual({ added: [], missing: [] });
    expect(fake.calls()).toHaveLength(0);
    expect(posts).toHaveLength(0);
  });

  it('does nothing when the issue has no skip label', async () => {
    const { r, posts } = await run({ governance: {} }, ['bug'], ['skip-adr']);
    expect(JSON.parse(r.stdout)).toEqual({ added: [], missing: [] });
    expect(posts).toHaveLength(0);
  });

  it('reports a label missing in the repository and never creates it', async () => {
    const { r, posts } = await run({ governance: {} }, ['skip-adr'], []);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ added: [], missing: ['skip-adr'] });
    expect(posts).toHaveLength(0);
  });
});

describe('github-pull-request skip label docs', () => {
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');
  it('hands the issue labels to Add-SkipLabels.ps1 and stays within 100 lines', () => {
    expect(skill).toContain('scripts/Add-SkipLabels.ps1 -Pr <pr> -IssueLabel');
    expect(skill).toContain('skip label missing');
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });
  it('governance doc describes the copy and keeps the manual fallback', () => {
    const doc = fs.readFileSync(path.join(root, 'docs/usage/governance.md'), 'utf-8');
    expect(doc).toContain('Add-SkipLabels.ps1');
    expect(doc).toContain('PR opened outside `github-pull-request`');
  });
});
