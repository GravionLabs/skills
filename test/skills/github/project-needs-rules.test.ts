import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const MODULE = path.resolve(
  __dirname,
  '../../../skills/github/github-project/scripts/NeedsRules.psm1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

// One pwsh process for all cases: input is a JSON array of blockers, output the JSON array of Test-BlockerUnresolved results
// plus the Needs value of an item per blockedByOpen count.
const run = (blockers: unknown[]) => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'needs-rules-')), 'b.json');
  fs.writeFileSync(file, JSON.stringify(blockers));
  const script = `Import-Module '${MODULE}' -Force
$b = Get-Content -Raw '${file}' | ConvertFrom-Json
ConvertTo-Json -InputObject @($b | ForEach-Object { [bool](Test-BlockerUnresolved $_) }) -Compress`;
  const r = spawnSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout) as boolean[];
};

describe.skipIf(!hasPwsh)('Test-BlockerUnresolved', () => {
  it('blocks while the blocker is open, whatever its project Status', () => {
    const out = run([
      { state: 'open', labels: [{ name: 'bug' }] },
      { state: 'OPEN', status: 'In release' },
      { state: 'OPEN', status: 'In Progress' },
      { state: 'OPEN', status: 'Done' },
      { state: 'OPEN' },
      { state: 'OPEN', labels: [] },
    ]);
    expect(out).toEqual([true, true, true, true, true, true]);
  });

  it('a closed blocker or one without state is resolved', () => {
    expect(
      run([
        { state: 'closed', labels: [] },
        { state: 'CLOSED', status: 'In Progress' },
        {},
        { state: '' },
      ]),
    ).toEqual([false, false, false, false]);
  });

  // Migration (#182): issues delivered before they closed on merge still carry merged; they count as resolved.
  it('an open blocker that still carries the label merged is resolved during the migration', () => {
    const out = run([
      { state: 'OPEN', labels: ['merged'] },
      { state: 'open', labels: [{ name: 'Merged' }] },
      { state: 'CLOSED', labels: ['merged'] },
      { state: 'OPEN', labels: ['merged-elsewhere', { name: 'unmerged' }] },
    ]);
    expect(out).toEqual([false, false, false, true]);
  });
});

// #435: the current milestone is found by number, padded or not (M003 < M003.1 < M010)
describe.skipIf(!hasPwsh)('Get-CurrentMilestone with padded titles', () => {
  const current = (titles: string[]) => {
    const script = `Import-Module '${MODULE}' -Force
$t = '${JSON.stringify(titles)}' | ConvertFrom-Json
Get-CurrentMilestone -Titles $t -LatestTag $null`;
    const r = spawnSync('pwsh', ['-NoProfile', '-Command', script], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return r.stdout.trim();
  };

  it.each([
    [['M010', 'M003.1 Sub', 'M003 Topic', 'M011'], 'M003 Topic'],
    [['M010', 'M3.1', 'M003.1', 'M011'], 'M3.1'],
    [['M010', 'M9', 'M011'], 'M9'],
    [['M011.1', 'M011', 'M010 (1.0.0)'], 'M010 (1.0.0)'],
  ])('%j gives %s', (titles, expected) => {
    expect(current(titles)).toBe(expected);
  });
});
