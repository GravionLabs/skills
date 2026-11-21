import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

// #837: every job that runs steps has timeout-minutes (a job that calls a reusable workflow cannot set it).
const dir = path.resolve(__dirname, '../../.github/workflows');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.yml'));

describe('workflow job timeouts', () => {
  it.each(files)('%s: every job without uses has timeout-minutes of at least 5', (file) => {
    const wf = parse(fs.readFileSync(path.join(dir, file), 'utf-8'));
    const missing: string[] = [];
    for (const [name, job] of Object.entries<{ uses?: string; 'timeout-minutes'?: number }>(
      wf.jobs,
    )) {
      if (job.uses) continue;
      const t = job['timeout-minutes'];
      if (typeof t !== 'number' || t < 5) missing.push(name);
    }
    expect(missing).toEqual([]);
  });
});
