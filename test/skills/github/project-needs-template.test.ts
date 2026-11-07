import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const root = path.resolve(__dirname, '../../..');
const tplDir = path.join(root, 'skills/github/github-project/templates');
const read = (p: string) => fs.readFileSync(p, 'utf-8');

type Wf = { jobs: Record<string, { uses?: string; with?: Record<string, unknown> }> };

// The caller templates of the github-project skill; ci's own copies of these workflows are checked in GravionLabs/ci.
describe.each([
  ['issue-events.yml', 'issues'],
  ['project-needs.yml', 'needs'],
])('template %s (#519)', (file, jobName) => {
  const text = read(path.join(tplDir, file));
  const tpl = parse(text) as Wf;

  it('calls issues.yml of GravionLabs/ci with the project URL placeholder', () => {
    const job = tpl.jobs[jobName];
    expect(job.uses).toBe('GravionLabs/ci/.github/workflows/issues.yml@v1');
    expect(job.with?.['project-url']).toBe('https://github.com/users/<owner>/projects/<n>');
  });

  it('has no leftover placeholders of the old inline workflow', () => {
    for (const p of ['__OWNER__', '__PROJECT_NUMBER__', '__TOKEN__']) expect(text).not.toContain(p);
  });

  it('names the ci README and passes the secrets explicitly', () => {
    expect(text).toMatch(/GravionLabs\/ci README/);
    expect(text).not.toContain('secrets: inherit\n');
    expect(text).toContain('PROJECT_TOKEN: ${{ secrets.PROJECT_TOKEN }}');
    expect(text).not.toContain('GH_PAT: ${{ secrets.GH_PAT }}');
  });
});
