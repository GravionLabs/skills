import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawnSync } from 'child_process';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';

const skillDir = path.resolve(__dirname, '../../../skills/github/github-release');
const script = path.join(skillDir, 'scripts/Get-PublishState.ps1');
const sha = 'a'.repeat(40);
const tagSha = 'b'.repeat(40);

// FAKE: { polls: runs[] per `run list` call (the last one repeats), tags, parents, release }
const handler = `(call, ctx) => {
  const f = JSON.parse(process.env.FAKE);
  const [a, b] = call.args;
  if (a === 'repo') return { rest: { nameWithOwner: 'o/r', url: 'https://github.com/o/r' } };
  if (a === 'run' && b === 'list') {
    const n = ctx.count(process.env.CASE);
    return { rest: f.polls[Math.min(n, f.polls.length) - 1] };
  }
  if (a === 'run' && b === 'view') return { rest: { jobs: [{ name: 'build', conclusion: 'success' }, { name: 'Release', conclusion: 'failure' }] } };
  if (a === 'run' && b === 'rerun') return { rest: '' };
  if (a === 'api' && b.includes('/tags?')) return { rest: f.tags };
  if (a === 'api' && b.includes('/compare/')) return { rest: { status: 'ahead', commits: [{ parents: new Array(f.parents).fill({}) }] } };
  if (a === 'release') { if (!f.release) throw new Error('release not found'); return { rest: f.release }; }
  throw new Error('unexpected ' + call.args.join(' '));
}`;

const run = (conclusion: string | null, attempt = 1) => [
  {
    databaseId: 7,
    workflowName: 'CI',
    status: conclusion ? 'completed' : 'in_progress',
    conclusion: conclusion ?? '',
    url: 'https://x/runs/7',
    attempt,
  },
];
const green = {
  tags: [{ name: 'v1.2.0', commit: { sha: tagSha } }],
  parents: 1,
  release: { isDraft: false, url: 'https://x/releases/v1.2.0' },
};

let tmp: string;
let repo: string;
let worker: PwshWorker;
let fake: ReturnType<typeof createFakeGh>;
let n = 0;

beforeAll(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'publish-')));
  repo = path.join(tmp, 'repo');
  spawnSync('git', ['init', '-q', repo]);
  fake = createFakeGh(tmp, handler);
  worker = new PwshWorker(script);
});
afterAll(() => {
  worker.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const invoke = async (data: object, args: string[] = [], env: NodeJS.ProcessEnv = {}) => {
  const before = fake.calls().length;
  const r = await worker.run(['-Sha', sha, '-PollSeconds', '0', ...args], {
    cwd: repo,
    env: {
      ...fake.env(),
      AGENT_EVENTS_DIR: undefined,
      FAKE: JSON.stringify(data),
      CASE: `case-${++n}`,
      ...env,
    },
  });
  const reruns = fake
    .calls()
    .slice(before)
    .filter((c) => c.args[1] === 'rerun');
  return { ...r, json: r.stdout.trim() ? JSON.parse(r.stdout) : null, reruns };
};
const readRun = (dir: string) => {
  const files = fs.readdirSync(dir);
  expect(files).toHaveLength(1);
  const events = fs
    .readFileSync(path.join(dir, files[0]), 'utf8')
    .trimEnd()
    .split('\n')
    .map((l) => JSON.parse(l));
  expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
  for (const e of events) expect(e).toMatchObject({ v: 1, run: path.basename(files[0], '.jsonl') });
  expect(events[0].run).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-/);
  return events;
};

describe('Get-PublishState.ps1', () => {
  it('success: waits for the runs, finds the tag on the changelog commit and writes publish-ok', async () => {
    const dir = path.join(tmp, 'ev-ok');
    const r = await invoke({ ...green, polls: [[], run(null), run('success')] }, [
      '-Wait',
      '-Rerun',
      '-Events',
      dir,
    ]);
    expect(r.status).toBe(0);
    expect(r.json).toMatchObject({
      state: 'ok',
      tag: 'v1.2.0',
      release: 'https://x/releases/v1.2.0',
      runs: [{ name: 'CI', conclusion: 'success' }],
    });
    expect(r.reruns).toHaveLength(0);
    const events = readRun(dir);
    expect(events.map((e) => e.type)).toEqual([
      'run.started',
      'ci.run.completed',
      'publish-ok',
      'run.finished',
    ]);
    expect(events[0]).toMatchObject({
      profiles: ['ci@1'],
      subject: { id: sha, title: `o/r@${sha.slice(0, 7)}` },
    });
    expect(events[1].ci).toEqual({ name: 'CI', conclusion: 'success', url: 'https://x/runs/7' });
    expect(events[3].outcome).toBe('succeeded');
  });

  it('failed then green: re-runs the failed jobs once, ignoring the old attempt', async () => {
    const r = await invoke(
      { ...green, polls: [run('failure'), run('failure'), run(null, 2), run('success', 2)] },
      ['-Wait', '-Rerun'],
    );
    expect(r.status).toBe(0);
    expect(r.json.state).toBe('ok');
    expect(r.reruns.map((c) => c.args)).toEqual([['run', 'rerun', '7', '--failed']]);
  });

  it('failed twice: exit 1 with the run URL and the failed job, publish-failed', async () => {
    const dir = path.join(tmp, 'ev-failed');
    const r = await invoke(
      { ...green, tags: [], polls: [run('failure'), run('failure'), run('failure', 2)] },
      ['-Wait', '-Rerun'],
      { AGENT_EVENTS_DIR: dir },
    );
    expect(r.status).toBe(1);
    expect(r.json).toMatchObject({ state: 'failed', runs: [{ failedJobs: ['Release'] }] });
    expect(r.json.reason).toContain('Release] https://x/runs/7');
    expect(r.reruns).toHaveLength(1);
    const events = readRun(dir);
    expect(events.at(-2)).toMatchObject({
      type: 'publish-failed',
      ci: { job: 'Release', url: 'https://x/runs/7' },
    });
    expect(events.at(-1)).toMatchObject({ type: 'run.finished', outcome: 'failed' });
  });

  it.each([
    ['no tag', { tags: [] }, /tag missing/],
    ['only the tag of a later release', { parents: 2 }, /tag missing/],
    ['no GitHub Release', { release: null }, /Release v1\.2\.0 missing/],
    ['a draft release', { release: { isDraft: true, url: 'u' } }, /is a draft/],
  ])('green run but %s: failed', async (_name, data, reason) => {
    const r = await invoke({ ...green, ...data, polls: [run('success')] });
    expect(r.status).toBe(1);
    expect(r.json.reason).toMatch(reason);
    expect(r.json.release).toBeNull();
  });

  it('pending after the wait: exit 2, no publish event; the default directory is used when present', async () => {
    const dir = path.join(repo, '.git/.agents/events');
    fs.mkdirSync(dir, { recursive: true });
    try {
      const r = await invoke({ ...green, polls: [run(null)] }, ['-Wait', '-TimeoutMinutes', '0']);
      expect(r.status).toBe(2);
      expect(r.json.state).toBe('pending');
      expect(readRun(dir).map((e) => e.type)).toEqual(['run.started', 'run.finished']);
    } finally {
      fs.rmSync(path.join(repo, '.git/.agents'), { recursive: true, force: true });
    }
  });

  it('writes nothing without -Events and the variable when the default directory is missing', async () => {
    const r = await invoke({ ...green, polls: [run('success')] });
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(repo, '.git/.agents'))).toBe(false);
  });

  it('an unreadable gh is exit 3', async () => {
    const r = await invoke({});
    expect(r.status).toBe(3);
    expect(r.stdout.trim()).toBe('');
  });

  it('finish uses the check before it closes the milestone', () => {
    const ref = fs.readFileSync(path.join(skillDir, 'references/close-milestone.md'), 'utf8');
    expect(ref.indexOf('Get-PublishState.ps1')).toBeGreaterThan(0);
    expect(ref.indexOf('Get-PublishState.ps1')).toBeLessThan(ref.indexOf('-Mode close'));
    const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    expect(skill).toContain('Get-PublishState.ps1 -Sha <merge commit> -Wait -Rerun');
  });
});
