import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const file = path.resolve(__dirname, '../../.github/workflows/pages.yml');
const text = fs.readFileSync(file, 'utf-8');
const wf = parse(text);

describe('pages.yml workflow guard (#272)', () => {
  it('pins every action to a 40-hex SHA followed by a comment', () => {
    const steps = Object.values(wf.jobs).flatMap(
      (j) => (j as { steps: { uses?: string }[] }).steps,
    );
    const usesSteps = steps.filter((s) => s.uses);
    expect(usesSteps.length).toBeGreaterThan(0);
    for (const s of usesSteps) expect(s.uses).toMatch(/^[\w./-]+@[0-9a-f]{40}$/);
    const lines = text.split('\n').filter((l) => /^\s*-?\s*uses:/.test(l));
    expect(lines.length).toBe(usesSteps.length);
    for (const line of lines) expect(line).toMatch(/@[0-9a-f]{40} # \S+/);
  });

  it('triggers on main, site-related pull requests and manual runs', () => {
    expect(wf.on.push.branches).toEqual(['main']);
    expect(wf.on.pull_request.paths).toEqual([
      'site/**',
      'docs/**',
      'README.md',
      'skills/**',
      '.claude-plugin/**',
      'scripts/generate-skill-list.mjs',
      'package.json',
      'pnpm-lock.yaml',
      '.github/workflows/pages.yml',
    ]);
    expect(wf.on).toHaveProperty('workflow_dispatch');
  });

  it('has read-only contents at top level', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
  });

  it('cancels only pull request runs and queues deployments', () => {
    expect(wf.concurrency.group).toBe(
      "pages-${{ github.event_name == 'pull_request' && github.ref || 'deploy' }}",
    );
    expect(wf.concurrency['cancel-in-progress']).toBe("${{ github.event_name == 'pull_request' }}");
  });

  it('builds on pull requests without upload, and deploys only from main with DEPLOY_PAGES', () => {
    const { build, deploy } = wf.jobs;
    expect(build.name).toBe('Build the site');
    expect(build.if).toBe("github.event_name == 'pull_request' || vars.DEPLOY_PAGES == 'true'");
    const upload = build.steps.find((s: { uses?: string }) =>
      s.uses?.includes('upload-pages-artifact'),
    );
    expect(upload.if).toBe(
      "github.event_name != 'pull_request' && github.ref == 'refs/heads/main'",
    );
    expect(upload.with.path).toBe('site/.vitepress/dist');
    expect(deploy.needs).toBe('build');
    expect(deploy.if).toBe(
      "github.event_name != 'pull_request' && github.ref == 'refs/heads/main' && vars.DEPLOY_PAGES == 'true'",
    );
    expect(deploy.permissions).toEqual({ pages: 'write', 'id-token': 'write' });
    expect(deploy.environment.name).toBe('github-pages');
    const step = deploy.steps.find((s: { id?: string }) => s.id === 'deployment');
    expect(step.uses).toMatch(/^actions\/deploy-pages@/);
  });

  it('installs, generates the skill list, then builds the site with the base from env', () => {
    const runs: string[] = wf.jobs.build.steps
      .map((s: { run?: string }) => s.run ?? '')
      .filter(Boolean);
    const at = (needle: string) => runs.findIndex((r) => r.includes(needle));
    expect(at('pnpm install --frozen-lockfile')).toBeGreaterThanOrEqual(0);
    expect(at('pnpm install')).toBeLessThan(at('pnpm run generate'));
    expect(at('pnpm run generate')).toBeLessThan(at('pnpm --filter site build'));
    expect(runs[at('pnpm --filter site build')]).toBe('SITE_BASE="$BASE" pnpm --filter site build');
    expect(wf.jobs.build.env.BASE).toBe('/${{ github.event.repository.name }}/');
  });

  it('never commits or pushes in a run step', () => {
    const runs = Object.values(wf.jobs).flatMap((j) =>
      (j as { steps: { run?: string }[] }).steps.map((s) => s.run ?? ''),
    );
    for (const r of runs) expect(r).not.toMatch(/git commit|git push/);
  });
});
