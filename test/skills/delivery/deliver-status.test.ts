import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const skillDir = path.resolve(__dirname, '../../../skills/delivery/deliver');
const script = path.join(skillDir, 'scripts/Get-DeliverStatus.ps1');
const base = 'https://github.com/acme/app';

type Issue = {
  number: number;
  title: string;
  state: 'open' | 'closed';
  body?: string;
  labels?: string[];
  assignees?: string[];
  blockedBy?: { number: number; repository?: string }[];
};

let tmp: string;

// fake Get-Milestones.ps1: prints the issues fixture
function fixture(name: string, issues: Issue[], nextTitle: string | null = 'M5'): string {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  const issuesJson = {
    milestone: { number: 4, title: 'M4 Status', state: 'open' },
    baseUrl: base,
    nextMilestone: nextTitle,
    issues: issues.map((i) => ({
      closed_at: null,
      body: '',
      labels: ['pbi'],
      assignees: [],
      ...i,
    })),
  };
  fs.writeFileSync(path.join(dir, 'issues.json'), JSON.stringify(issuesJson));
  const fake = path.join(dir, 'Get-Milestones.ps1');
  fs.writeFileSync(
    fake,
    `param($Mode,$Name,$State,$Repo)\nGet-Content -Raw (Join-Path $PSScriptRoot ($Mode + '.json'))\n`,
  );
  return fake;
}

function run(fake: string, extra: string[] = [], releasePr = '') {
  return spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-File',
      script,
      '-Milestone',
      'M4',
      '-BaseUrl',
      base,
      '-ReleasePr',
      releasePr,
      '-MilestonesScript',
      fake,
      ...extra,
    ],
    { encoding: 'utf8' },
  );
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deliver-status-'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('Get-DeliverStatus.ps1', () => {
  it.each([
    ['M011.1 Sub', 'M011.1'],
    ['M003 Topic (1.2.0)', 'M003'],
    ['M3 Topic', 'M3'],
  ])(
    'the key of the title %s is its M<n> prefix %s, as written (padded titles, #435; M4 stays M4 above)',
    (title, key) => {
      const fake = fixture(`key-${key}-${title.length}`, [
        { number: 1, title: 'feat: one', state: 'open' },
      ]);
      const file = path.join(path.dirname(fake), 'issues.json');
      const j = JSON.parse(fs.readFileSync(file, 'utf8'));
      j.milestone.title = title;
      fs.writeFileSync(file, JSON.stringify(j));
      const r = run(fake);
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).key).toBe(key);
    },
  );

  it('builds the block of a running milestone as JSON', () => {
    const fake = fixture('running', [
      { number: 1, title: 'feat: one', state: 'closed' },
      { number: 2, title: 'feat: two', state: 'open' },
      { number: 3, title: 'feat: three', state: 'open', body: 'Blocked by #2' },
      { number: 4, title: 'feat: four', state: 'open', labels: ['pbi', 'needs-decision'] },
      { number: 5, title: 'feat: five', state: 'open', labels: ['pbi', 'interactive'] },
    ]);
    const r = run(fake, ['-Delivered', '1']);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.key).toBe('M4');
    expect(j.closed).toBe(1);
    expect(j.total).toBe(5);
    expect(j.delivered).toEqual([{ number: 1, url: `${base}/issues/1`, title: 'feat: one' }]);
    expect(j.ready.count).toBe(1);
    expect(j.ready.next.url).toBe(`${base}/issues/2`);
    expect(j.waiting).toHaveLength(1);
    expect(j.waiting[0].reason).toBe(`blocked by ${base}/issues/2`);
    expect(j.needsYou).toHaveLength(2);
    expect(j.release.state).toBe('not ready');
    expect(j.next).toBe('M5');
  });

  it('#346: an open (paused) issue passed to -Delivered is not listed as delivered', () => {
    const fake = fixture('open-delivered', [
      { number: 1, title: 'feat: one', state: 'closed' },
      { number: 2, title: 'feat: two', state: 'open', labels: ['pbi', 'needs-decision'] },
    ]);
    const r = run(fake, ['-Delivered', '2']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).delivered).toEqual([]);
  });

  it('shows the tier distribution of the open items (Tier line, else size, else standard)', () => {
    const fake = fixture('tiers', [
      { number: 1, title: 'a', state: 'open', body: 'Tier: fast — docs' },
      { number: 2, title: 'b', state: 'open', body: 'Size: S' },
      { number: 3, title: 'c', state: 'open', body: 'Size: L' },
      { number: 4, title: 'd', state: 'open', body: 'Size: L\nTier: standard — x' },
      { number: 5, title: 'e', state: 'open' },
      { number: 6, title: 'f', state: 'closed', body: 'Tier: strong — done' },
    ]);
    const j = JSON.parse(run(fake).stdout);
    expect(j.tiers).toEqual({ fast: 2, standard: 2, strong: 1 });
    expect(run(fake, ['-Text']).stdout.split('\n')[0]).toBe(
      'Milestone M4: 1/6 closed · fast 2 · standard 2 · strong 1',
    );
  });

  it('prints at most 10 lines of text with full URLs and numbered needs-you items', () => {
    const issues: Issue[] = [{ number: 1, title: 'feat: one', state: 'closed' }];
    for (let n = 10; n < 16; n++)
      issues.push({
        number: n,
        title: `feat: d${n}`,
        state: 'open',
        labels: ['pbi', 'needs-decision'],
      });
    const r = run(fixture('many', issues), ['-Text']);
    const lines = r.stdout.trimEnd().split('\n');
    expect(lines.length).toBeLessThanOrEqual(10);
    expect(lines[0]).toBe('Milestone M4: 1/7 closed · standard 6');
    expect(r.stdout).toContain(`1. decision: ${base}/issues/10 feat: d10`);
    expect(r.stdout).toContain('(+3 more)');
    expect(r.stdout).not.toMatch(/(^|\s)#\d+/);
  });

  it('reports the release review round when all work is closed', () => {
    const fake = fixture('review', [
      { number: 1, title: 'feat: one', state: 'closed' },
      {
        number: 2,
        title: 'fix: two',
        state: 'closed',
        labels: ['bug'],
        body: 'Found in release review round 1',
      },
    ]);
    const j = JSON.parse(run(fake).stdout);
    expect(j.release).toEqual({ state: 'release review', round: 2, pr: null });
    expect(j.ready.count).toBe(0);
  });

  it('lists the release PR as an item that needs the user', () => {
    const fake = fixture('pr', [{ number: 1, title: 'feat: one', state: 'closed' }], null);
    const j = JSON.parse(run(fake, [], `${base}/pull/9`).stdout);
    expect(j.release).toEqual({ state: 'release PR', round: null, pr: `${base}/pull/9` });
    expect(j.needsYou).toEqual([`merge the release PR: ${base}/pull/9`]);
    expect(j.next).toBeNull();
  });

  it('marks claimed and unrefined PBIs as waiting and reads an empty milestone', () => {
    const j = JSON.parse(
      run(
        fixture('wait', [
          { number: 2, title: 'a', state: 'open', assignees: ['bob'] },
          { number: 3, title: 'b', state: 'open', labels: ['pbi', 'needs-refinement'] },
        ]),
      ).stdout,
    );
    expect(j.waiting.map((w: { reason: string }) => w.reason)).toEqual([
      'claimed by bob',
      'needs refinement',
    ]);
    const empty = JSON.parse(run(fixture('empty', [])).stdout);
    expect(empty.total).toBe(0);
  });

  it('uses native blocked-by links, not the body, when the read carries them', () => {
    const fake = fixture('native', [
      { number: 2, title: 'feat: two', state: 'open', blockedBy: [{ number: 9 }] },
      {
        number: 3,
        title: 'feat: three',
        state: 'open',
        blockedBy: [{ number: 7, repository: 'acme/other' }],
      },
      { number: 4, title: 'feat: four', state: 'open', body: 'Blocked by #2', blockedBy: [] },
    ]);
    const j = JSON.parse(run(fake).stdout);
    expect(j.waiting.map((w: { reason: string }) => w.reason)).toEqual([
      `blocked by ${base}/issues/9`,
      'blocked by https://github.com/acme/other/issues/7',
    ]);
    expect(j.ready.count).toBe(1);
    expect(j.ready.next.number).toBe(4);
  });

  it('#347: closed and total count only PBIs and Bugs, an open Feature does not count', () => {
    const fake = fixture('feature', [
      { number: 1, title: 'feat: one', state: 'closed' },
      { number: 2, title: 'fix: two', state: 'closed', labels: ['bug'] },
      { number: 3, title: 'feat: three', state: 'open' },
      { number: 9, title: '[Feature] open', state: 'open', labels: ['feature'] },
    ]);
    const j = JSON.parse(run(fake).stdout);
    expect(j.closed).toBe(2);
    expect(j.total).toBe(3);
    expect(run(fake, ['-Text']).stdout.split('\n')[0]).toBe(
      'Milestone M4: 2/3 closed · standard 1',
    );
  });

  it('fails when the milestone cannot be read', () => {
    const bad = path.join(tmp, 'bad.ps1');
    fs.writeFileSync(bad, 'exit 1\n');
    const r = run(bad);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('failed');
  });
});

describe('deliver status docs', () => {
  const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
  const help = fs.readFileSync(path.join(skillDir, 'references/help.md'), 'utf8');

  it('names the status block, the script and the status command', () => {
    expect(skill).toContain('## Status block');
    expect(skill).toContain('Get-DeliverStatus.ps1');
    expect(skill).toContain('/deliver status --milestone <name>');
    expect(help).toContain('/deliver status --milestone <name>');
    expect(help).toContain('Get-DeliverStatus.ps1');
  });
});

describe('release-test label (#377)', () => {
  const rc = {
    number: 9,
    title: 'test: RC',
    state: 'open' as const,
    labels: ['pbi', 'interactive', 'release-test'],
  };

  it('waits while other PBIs or Bugs are open, counted in total, not as needs you', () => {
    const fake = fixture('rc-wait', [
      { number: 2, title: 'feat: two', state: 'open' },
      { number: 3, title: 'fix: three', state: 'open', labels: ['bug'] },
      rc,
    ]);
    const j = JSON.parse(run(fake).stdout);
    expect(j.total).toBe(3);
    expect(j.needsYou).toEqual([]);
    const w = j.waiting.find((x: { number: number }) => x.number === 9);
    expect(w.reason).toBe('release test, waits for 2 open items');
  });

  it('as the last item: waiting "release test" without an RC, needs you "RC test <url>" once posted', () => {
    const none = JSON.parse(
      run(fixture('rc-last', [{ number: 1, title: 'a', state: 'closed' }, rc])).stdout,
    );
    expect(none.waiting[0].reason).toBe('release test');
    expect(none.needsYou).toEqual([]);
    const posted = JSON.parse(
      run(fixture('rc-posted', [{ ...rc, rcPosted: true } as never])).stdout,
    );
    expect(posted.needsYou).toEqual([`RC test ${base}/issues/9 test: RC`]);
    expect(posted.waiting).toEqual([]);
    expect(posted.total).toBe(1);
  });
});
