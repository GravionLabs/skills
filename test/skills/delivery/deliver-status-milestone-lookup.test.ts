import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

// Get-DeliverStatus.ps1 finds Get-Milestones.ps1 without -MilestonesScript:
// installed (flat: ~/.claude/skills/<name>/) and repository (skills/<group>/<name>/) layouts.
const deliverSrc = path.resolve(__dirname, '../../../skills/delivery/deliver');
const base = 'https://github.com/acme/app';

let tmp: string;

// copies deliver into `dest` and puts a fake github-milestone next to it at `milestoneDir`
function layout(root: string, deliverDir: string, milestoneDir: string): string {
  const deliver = path.join(root, deliverDir);
  fs.cpSync(deliverSrc, deliver, { recursive: true });
  const ms = path.join(root, milestoneDir, 'scripts');
  fs.mkdirSync(ms, { recursive: true });
  fs.writeFileSync(
    path.join(ms, 'issues.json'),
    JSON.stringify({
      milestone: { number: 4, title: 'M4 Status', state: 'open' },
      baseUrl: base,
      nextMilestone: null,
      issues: [
        {
          number: 1,
          title: 'feat: one',
          state: 'closed',
          body: '',
          labels: ['pbi'],
          assignees: [],
        },
      ],
    }),
  );
  fs.writeFileSync(
    path.join(ms, 'Get-Milestones.ps1'),
    `param($Mode,$Name,$State,$Repo)\nGet-Content -Raw (Join-Path $PSScriptRoot 'issues.json')\n`,
  );
  return path.join(deliver, 'scripts/Get-DeliverStatus.ps1');
}

function run(script: string) {
  return spawnSync(
    'pwsh',
    ['-NoProfile', '-File', script, '-Milestone', 'M4', '-BaseUrl', base, '-ReleasePr', ''],
    {
      encoding: 'utf8',
    },
  );
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'deliver-milestone-lookup-'));
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('Get-DeliverStatus.ps1 finds github-milestone', () => {
  it('finds the sibling github-milestone in a flat installed layout', () => {
    const script = layout(path.join(tmp, 'flat'), 'deliver', 'github-milestone');
    const r = run(script);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).total).toBe(1);
  });

  it('finds github-milestone in the repository layout', () => {
    const script = layout(
      path.join(tmp, 'repo'),
      'skills/delivery/deliver',
      'skills/github/github-milestone',
    );
    const r = run(script);
    expect(r.stderr).toBe('');
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).total).toBe(1);
  });

  it('names both candidate paths when github-milestone is missing', () => {
    const script = layout(path.join(tmp, 'alone'), 'deliver', 'unused');
    fs.rmSync(path.join(tmp, 'alone', 'unused'), { recursive: true, force: true });
    const r = run(script);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('../../github-milestone/scripts/Get-Milestones.ps1');
    expect(r.stderr).toContain('../../../github/github-milestone/scripts/Get-Milestones.ps1');
  });
});
