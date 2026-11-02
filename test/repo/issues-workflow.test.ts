import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const workflows = path.resolve(__dirname, '../../.github/workflows');
const text = fs.readFileSync(path.join(workflows, 'issues.yml'), 'utf-8');
const wf = parse(text);

describe('project Needs sync (#115)', () => {
  it('has no hourly full sync of its own: GravionLabs/ci syncs project 17 nightly', () => {
    expect(fs.existsSync(path.join(workflows, 'project-needs.yml'))).toBe(false);
  });

  it('keeps the event-driven needs sync in issues.yml', () => {
    const job = wf.jobs.issues;
    expect(wf.on.schedule).toBeUndefined();
    expect(job.uses).toBe('GravionLabs/ci/.github/workflows/issues.yml@v1');
    expect(job.with['project-url']).toBe('https://github.com/users/GravionLabs/projects/17');
    expect(job.with.needs).toBe(true);
    expect(job.with.mode).toBeUndefined();
  });

  it('passes the two secrets explicitly instead of inheriting', () => {
    expect(wf.jobs.issues.secrets).toEqual({
      GH_PAT: '${{ secrets.GH_PAT }}',
      PROJECT_TOKEN: '${{ secrets.PROJECT_TOKEN }}',
    });
  });
});
