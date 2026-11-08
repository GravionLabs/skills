import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';

const SKILL = path.resolve(__dirname, '../../../skills/delivery/deliver');
const script = (n: string) => path.join(SKILL, 'scripts', n);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const base = 'https://github.com/acme/app';
const pwsh = (file: string, args: string[], opts: object = {}) =>
  spawnSync('pwsh', ['-NoProfile', '-File', file, ...args], { encoding: 'utf8', ...opts });

// #480: after a clean review deliver sets auto-merge and goes on; outcome `merging`
describe('deliver auto-merge docs (#480)', () => {
  const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
  it('step 8 sets auto-merge, keeps the claim and reports the outcome merging', () => {
    expect(skill).toContain('gh pr merge <pr> --squash --auto --delete-branch');
    expect(skill).toContain('#<nr> merge: auto-merge on, waits for checks');
    expect(skill).toContain('issue.finished -Outcome merging');
    expect(skill).toContain('--watch --required --interval 60');
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });
});

describe.skipIf(!hasPwsh || process.platform === 'win32')('auto-merge scripts (#480)', () => {
  let root: string;
  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'automerge-')));
  });
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  describe('preflight merge check', () => {
    const check = (name: string, allowAuto: boolean, rules: string[]) => {
      const gh = createFakeGh(
        path.join(root, name),
        `(call) => call.args[1].includes('/rules/branches/')
          ? { rest: ${JSON.stringify(rules.map((type) => ({ type })))} }
          : { rest: { allow_auto_merge: ${allowAuto} } }`,
      );
      const repo = path.join(root, `${name}-repo`);
      fs.mkdirSync(repo);
      execFileSync('git', ['init', '-q'], { cwd: repo });
      const run = (...extra: string[]) =>
        pwsh(
          script('Test-DeliverPreflight.ps1'),
          ['-ProjectRoot', repo, '-Check', 'merge', ...extra],
          {
            cwd: repo,
            env: gh.env(),
          },
        );
      return { text: run('-Text').stdout.trim(), mode: JSON.parse(run().stdout).checks[0].mode };
    };
    it.each([
      ['auto', true, ['required_status_checks'], 'auto-merge on, no watch'],
      ['watch', false, ['required_status_checks'], 'auto-merge off, watching checks'],
      ['watch-no-required', true, ['deletion'], 'no required checks on release/next'],
      ['watch-no-required', false, [], 'no required checks on release/next'],
    ])('mode %s (auto-merge allowed %s, rules %j)', (expected, allow, rules, note) => {
      const r = check(
        `m-${expected}-${allow}-${rules.length}`,
        allow as boolean,
        rules as string[],
      );
      expect(r.mode).toBe(expected);
      expect(r.text).toBe(`preflight merge: ok - ${note}`);
    });
  });

  describe('Remove-PbiWorktrees.ps1 without a merged PR', () => {
    it('removes the worktree and branch of a PR that is still open with auto-merge on', () => {
      const origin = path.join(root, 'origin.git');
      const repo = path.join(root, 'repo');
      const git = (cwd: string, ...a: string[]) =>
        execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
      git(root, 'init', '-q', '--bare', '-b', 'release/next', origin);
      git(root, 'clone', '-q', origin, repo);
      for (const [k, v] of [
        ['user.email', 't@e.com'],
        ['user.name', 't'],
        ['commit.gpgsign', 'false'],
      ])
        git(repo, 'config', k, v);
      git(repo, 'commit', '-q', '--allow-empty', '-m', 'base');
      git(repo, 'push', '-q', 'origin', 'release/next');
      git(repo, 'switch', '-q', '-c', 'feat/12-x');
      git(repo, 'commit', '-q', '--allow-empty', '-m', 'feat');
      git(repo, 'push', '-q', 'origin', 'feat/12-x');
      const sha = git(repo, 'rev-parse', 'HEAD');
      git(repo, 'switch', '-q', 'release/next');
      const wt = path.join(repo, '.claude/worktrees/a');
      git(repo, 'worktree', 'add', '-q', '-b', 'worktree-a', wt);
      git(wt, 'switch', '-q', 'feat/12-x');
      const gh = createFakeGh(
        path.join(root, 'gh-open'),
        `(call) => call.args[1].endsWith('/commits?per_page=100')
          ? { rest: [{ sha: '${sha}' }] }
          : { rest: { state: 'open', merged: false, auto_merge: { merge_method: 'squash' }, head: { ref: 'feat/12-x' } } }`,
      );
      const r = pwsh(script('Remove-PbiWorktrees.ps1'), ['-Pr', '9', '-Issue', '12'], {
        cwd: repo,
        env: gh.env(),
      });
      expect(r.status, r.stderr).toBe(0);
      const out = JSON.parse(r.stdout);
      expect(out.removed).toEqual([wt]);
      expect(out.branchesDeleted).toContain('feat/12-x');
      expect(out.left).toEqual([]);
    });
  });

  describe('outcome merging', () => {
    it('Get-DeliverStatus lists a merging PBI as waiting, not delivered', () => {
      const dir = path.join(root, 'status');
      fs.mkdirSync(dir);
      const issue = (number: number, assignees: string[]) => ({
        number,
        title: `[PBI] t${number}`,
        state: 'open',
        body: '',
        labels: ['pbi'],
        assignees,
        closed_at: null,
      });
      fs.writeFileSync(
        path.join(dir, 'issues.json'),
        JSON.stringify({
          milestone: { number: 4, title: 'M4 Status', state: 'open' },
          baseUrl: base,
          nextMilestone: null,
          issues: [issue(480, ['me']), issue(481, [])],
        }),
      );
      fs.writeFileSync(
        path.join(dir, 'Get-Milestones.ps1'),
        `param($Mode,$Name,$State,$Repo)\nGet-Content -Raw (Join-Path $PSScriptRoot ($Mode + '.json'))\n`,
      );
      const r = pwsh(script('Get-DeliverStatus.ps1'), [
        '-Milestone',
        'M4',
        '-BaseUrl',
        base,
        '-ReleasePr',
        '',
        '-Merging',
        '480',
        '-MilestonesScript',
        path.join(dir, 'Get-Milestones.ps1'),
      ]);
      expect(r.status, r.stderr).toBe(0);
      const j = JSON.parse(r.stdout);
      expect(j.delivered).toEqual([]);
      expect(j.waiting.map((w: any) => [w.number, w.reason])).toEqual([
        [480, 'merging, waits for checks'],
      ]);
      expect(j.ready.next.number).toBe(481);
    });

    it('the progress reducer folds issue.finished merging as neither delivered nor blocked', () => {
      const ev = (seq: number, type: string, extra: object) =>
        JSON.stringify({
          v: 1,
          seq,
          ts: `2026-11-07T10:0${seq}:00.000Z`,
          run: 'r1',
          type,
          tone: 'neutral',
          ...extra,
        });
      const issue = { number: 480, url: `${base}/issues/480` };
      const file = path.join(root, 'merging.jsonl');
      fs.writeFileSync(
        file,
        [
          ev(1, 'run.started', { source: 'loop', harness: 'claude', repository: 'acme/app' }),
          ev(2, 'issue.started', { issue }),
          ev(3, 'issue.finished', {
            issue,
            outcome: 'merging',
            reason: 'auto-merge on, waits for checks',
          }),
        ].join('\n') + '\n',
      );
      const r = pwsh(script('ConvertFrom-ProgressEvents.ps1'), [
        '-Path',
        file,
        '-Now',
        '2026-11-07 10:05:00Z',
        '-NoPidCheck',
      ]);
      expect(r.status, r.stderr).toBe(0);
      const s = JSON.parse(r.stdout);
      expect([s.delivered, s.blocked, s.paused, s.current]).toEqual([[], [], [], null]);
    });
  });
});
