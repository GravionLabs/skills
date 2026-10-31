import { spawnSync } from 'node:child_process';
import * as path from 'node:path';

const script = path.resolve(__dirname, '../../scripts/Invoke-TriggerEvals.ps1');
const hasPwsh = spawnSync('sh', ['-c', 'command -v pwsh']).status === 0;

// Single spawns: -DryRun must not call claude, and the -Skill filter needs its own argv.
describe.skipIf(!hasPwsh)('Invoke-TriggerEvals.ps1 -DryRun', () => {
  const run = (...args: string[]) =>
    spawnSync('pwsh', ['-NoProfile', '-File', script, '-DryRun', ...args], {
      encoding: 'utf8',
      cwd: path.resolve(__dirname, '../..'),
    });

  it('lists the prompts of a skill with the claude command and calls nothing', () => {
    const r = run('-Skill', 'planner');
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Command: claude -p <prompt> --output-format stream-json/);
    expect(r.stdout).toMatch(/--tools Skill,Read,Glob,Grep/);
  });

  it('exits non-zero for an unknown parameter', () => {
    expect(run('-NoSuchParameter').status).not.toBe(0);
  });
});
