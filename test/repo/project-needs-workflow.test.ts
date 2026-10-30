import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const file = path.resolve(__dirname, '../../.github/workflows/project-needs.yml');
const text = fs.readFileSync(file, 'utf-8');
const wf = parse(text);
describe('project-needs.yml (#639)', () => {
  const job = wf.jobs.needs;

  it('has only the hourly schedule and workflow_dispatch triggers', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['schedule', 'workflow_dispatch']);
    expect(wf.on.schedule).toEqual([{ cron: '0 * * * *' }]);
  });

  it('grants nothing at top level and issues: write to the job', () => {
    expect(wf.permissions).toEqual({});
    expect(job.permissions).toEqual({ issues: 'write' });
    expect(text).not.toContain('continue-on-error');
  });

  it('calls issues.yml of GravionLabs/ci with a full needs sync and has no steps', () => {
    expect(job.uses).toBe('GravionLabs/ci/.github/workflows/issues.yml@main');
    expect(job.with['project-url']).toBe('https://github.com/users/GravionLabs/projects/17');
    expect(job.with.needs).toBe(true);
    expect(job.with.mode).toBe('full');
    expect(job.steps).toBeUndefined();
  });

  it('passes the two secrets explicitly instead of inheriting', () => {
    expect(job.secrets).toEqual({
      GH_PAT: '${{ secrets.GH_PAT }}',
      PROJECT_TOKEN: '${{ secrets.PROJECT_TOKEN }}',
    });
  });
});
