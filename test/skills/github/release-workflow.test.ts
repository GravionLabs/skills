import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const root = path.resolve(__dirname, '../../..');
const files = {
  workflow: '.github/workflows/release-branch.yml',
  template: 'skills/github/github-release/templates/release-branch.yml',
};

describe.each(Object.entries(files))('release-branch caller %s (#358)', (_name, rel) => {
  const wf = parse(fs.readFileSync(path.join(root, rel), 'utf-8'));
  const job = wf.jobs['release-branch'];

  it('is valid YAML triggered by release branches', () => {
    expect(wf.on.push.branches).toEqual(['release/**']);
    expect(wf.on.workflow_dispatch.inputs['dry-run'].type).toBe('boolean');
  });

  it('has no permissions at the top and grants the job what the reusable workflow requests', () => {
    expect(wf.permissions).toEqual({});
    expect(job.permissions).toEqual({
      contents: 'read',
      issues: 'write',
      'pull-requests': 'write',
    });
  });

  it('calls the reusable release-branch.yml of GravionLabs/ci with explicit secrets and a project', () => {
    expect(job.uses).toBe('GravionLabs/ci/.github/workflows/release-branch.yml@v1');
    expect(job.with['project-url']).toMatch(/^https:\/\/github\.com\/users\//);
    expect(job.secrets).toEqual({
      GH_PAT: '${{ secrets.GH_PAT }}',
      PROJECT_TOKEN: '${{ secrets.PROJECT_TOKEN }}',
    });
    expect(job.with).not.toHaveProperty('label');
    expect(job.with).not.toHaveProperty('project-status');
    expect(job.steps).toBeUndefined();
  });
});

describe('issue-events.yml (#358)', () => {
  const wf = parse(fs.readFileSync(path.join(root, '.github/workflows/issues.yml'), 'utf-8'));
  const job = wf.jobs.issues;

  it('calls issues.yml of GravionLabs/ci with the Needs sync and explicit secrets', () => {
    expect(job.uses).toBe('GravionLabs/ci/.github/workflows/issues.yml@v1');
    expect(job.with.needs).toBe(true);
    expect(job.permissions).toEqual({ issues: 'write' });
    expect(job.secrets).toEqual({
      GH_PAT: '${{ secrets.GH_PAT }}',
      PROJECT_TOKEN: '${{ secrets.PROJECT_TOKEN }}',
    });
  });
});

describe('release workflow and template call the same reusable workflow (#489)', () => {
  it('differ only in the project URL, the comments and the project-url placeholder', () => {
    const [w, t] = [files.workflow, files.template].map((f) =>
      parse(fs.readFileSync(path.join(root, f), 'utf-8')),
    );
    const strip = (x: { jobs: Record<string, { with?: unknown }> }) => ({
      ...x,
      jobs: { 'release-branch': { ...x.jobs['release-branch'], with: undefined } },
    });
    expect(strip(w)).toEqual(strip(t));
  });
});

describe('closing docs (#382)', () => {
  const read = (p: string) => fs.readFileSync(path.join(root, 'skills', 'github', p), 'utf-8');

  it('closing.md covers the close at merge, the safety net, a reverted PR and the one-time dispatch', () => {
    const doc = read('github-release/references/closing.md');
    expect(doc).toContain('ships with <milestone>');
    expect(doc).toContain('close-release-issues');
    expect(doc).toMatch(/reverted[\s\S]*reopen its issues by hand/);
    expect(doc).toMatch(/`workflow_dispatch`[\s\S]*`merged`/);
    expect(doc).toMatch(/GravionLabs\/ci#55/);
    expect(doc).toMatch(/gh issue view 55 -R GravionLabs\/ci/);
    expect(
      fs.existsSync(path.join(root, 'skills/github/github-release/references/merged-label.md')),
    ).toBe(false);
  });

  it('github-release links closing.md and no skill or doc names the merged label', () => {
    expect(read('github-release/SKILL.md')).toContain('references/closing.md');
    expect(read('github-release/references/help.md')).toContain('references/closing.md');
    expect(read('github-issue/references/release-branches.md')).toContain('references/closing.md');
    expect(read('github-issue/references/milestones.md')).toMatch(/closed milestone/);
  });
});

const skillDir = path.join(root, 'skills/github/github-release');
const skill = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf-8');

describe('github-release skill (#358, #769)', () => {
  it('cut checks for mark-merged-issues and never adds the template silently', () => {
    expect(skill).toContain('releaseWorkflow');
    expect(skill).toContain('templates/release-branch.yml');
    expect(skill).toContain('never silently');
    expect(fs.existsSync(path.join(skillDir, 'references/closing.md'))).toBe(true);
  });

  it('is at most 60 lines and has no shell control flow, grep, $( or &&', () => {
    expect(skill.split('\n').length).toBeLessThanOrEqual(60);
    expect(skill).not.toMatch(/\bfor\b[ \t]+\w+[ \t]+in\b|\bgrep\b|\$\(|&&/);
    const fences = skill.match(/```\w*/g) ?? [];
    expect(fences.filter((f) => f !== '```').every((f) => f === '```powershell')).toBe(true);
  });

  it('runs the state script in both modes and decides per state', () => {
    expect(fs.existsSync(path.join(skillDir, 'scripts/Get-ReleaseState.ps1'))).toBe(true);
    expect(skill).toContain('scripts/Get-ReleaseState.ps1 -Mode cut');
    expect(skill).toContain('-Mode finish');
    for (const state of [
      'absent',
      'fresh',
      'unreleased',
      'behind',
      'merged',
      'released',
      'released-continued',
    ]) {
      expect(skill).toContain(`\`${state}\``);
    }
  });
});

describe('github-release skill refuses a released branch (#252)', () => {
  const reference = fs.readFileSync(
    path.join(root, 'skills/github/github-issue/references/release-branches.md'),
    'utf-8',
  );
  const section = (text: string, from: string, to: string) => {
    const start = text.indexOf(from);
    const end = text.indexOf(to, start + 1);
    if (start < 0 || end < 0) throw new Error(`marker missing: ${from} … ${to}`);
    return text.slice(start, end);
  };
  const cut = section(skill, '## cut', '## finish');
  const finish = section(skill, '## finish', '## Gotchas');

  it('finish stops with "already released; cut a new release branch" for released states', () => {
    expect(skill).toContain('already released; cut a new release branch');
    expect(skill).toMatch(/`released-continued`/);
  });

  it('finish names the branch delete, never waits for the merge and leaves the delete to a later finish', () => {
    expect(finish).toContain('git push origin --delete <branch>');
    expect(finish).toContain('never wait for the merge');
    expect(finish).not.toContain('gh pr view <nr> --json merged');
    expect(finish).toContain('`delete-branch`');
  });

  it('cut reports a stale release/<x.y> with the delete command before cutting', () => {
    expect(cut).toContain('staleLines');
    expect(cut).toContain('git push origin --delete release/<x.y>');
    expect(cut).toContain('guardrail');
    expect(skill).not.toContain('GIT_GUARDRAILS_OFF');
  });

  it('resolver step 4 ignores release branches whose .0 tag exists', () => {
    const step4 = section(reference, '4. `release/next` on origin', '5. None exists');
    expect(step4).toContain('whose tag `v<x.y>.0` is not on origin');
    expect(step4).toContain('Get-ReleaseState.ps1 -Mode base');
    expect(step4).not.toContain('git ls-remote');
    expect(reference).toContain('already released');
  });
});
