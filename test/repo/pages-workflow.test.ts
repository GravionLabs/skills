import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const file = path.resolve(__dirname, '../../.github/workflows/pages.yml');
const text = fs.readFileSync(file, 'utf-8');
const wf = parse(text);

describe('pages.yml workflow guard (#494)', () => {
  it('calls the reusable VitePress workflow of GravionLabs/ci at @v1', () => {
    expect(Object.keys(wf.jobs)).toEqual(['pages']);
    const job = wf.jobs.pages;
    expect(job.uses).toBe('GravionLabs/ci/.github/workflows/vitepress-pages.yml@v1');
    expect(job.with).toEqual({
      'site-path': 'site',
      'package-manager': 'pnpm',
      'pre-build': 'pnpm run generate',
      deploy: true,
    });
    expect(job.permissions).toEqual({ contents: 'read', pages: 'write', 'id-token': 'write' });
    expect(job.steps).toBeUndefined();
  });

  it('triggers on main, site-related pull requests and manual runs', () => {
    expect(wf.on.push.branches).toEqual(['main']);
    expect(wf.on.pull_request.paths).toEqual([
      'site/**',
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

  it('has no permissions at top level and no repository variable switch', () => {
    expect(wf.permissions).toEqual({});
    expect(text).not.toContain('DEPLOY_PAGES');
    expect(text).not.toContain('vars.');
  });
});
