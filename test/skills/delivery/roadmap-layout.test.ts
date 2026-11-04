import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createFakeGh } from '../../helpers/fake-gh';

const skills = path.resolve(__dirname, '../../../skills');

// gh answers: no issues, one open milestone M1.
const handler = `(call) => {
  const p = call.args[1] || '';
  if (p.includes('/milestones?')) return { rest: [[{ number: 1, title: 'M1', state: 'open', open_issues: 0, closed_issues: 0, due_on: null, html_url: 'https://x/m/1' }]] };
  if (call.args[0] === 'issue') return { rest: {} };
  return { rest: [[]] };
}`;

const siblings = [
  ['delivery', 'roadmap'],
  ['github', 'github-milestone'],
  ['github', 'github-release'],
];

// Both layouts: npx skills installs flat (<root>/<name>), the repository nests (<root>/<group>/<name>).
function build(layout: 'flat' | 'repo'): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `roadmap-${layout}-`));
  for (const [group, name] of siblings) {
    const dest = layout === 'flat' ? path.join(root, name) : path.join(root, group, name);
    fs.cpSync(path.join(skills, group, name), dest, { recursive: true });
  }
  return root;
}

const pwsh = (file: string, args: string[], env: NodeJS.ProcessEnv, cwd: string) =>
  spawnSync('pwsh', ['-NoProfile', '-File', file, ...args], { cwd, env, encoding: 'utf8' });

describe.each(['flat', 'repo'] as const)(
  'roadmap scripts find Get-Milestones.ps1 (%s layout)',
  (layout) => {
    let root: string;
    let work: string;
    let fake: ReturnType<typeof createFakeGh>;
    beforeAll(() => {
      root = build(layout);
      work = fs.mkdtempSync(path.join(os.tmpdir(), 'roadmap-work-'));
      fake = createFakeGh(work, handler);
    });
    afterAll(() => {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(work, { recursive: true, force: true });
    });
    const roadmap = () =>
      layout === 'flat' ? path.join(root, 'roadmap') : path.join(root, 'delivery', 'roadmap');
    const milestoneCalls = () =>
      fake.calls().filter((c) => (c.args[1] || '').includes('/milestones'));

    it('Get-RoadmapState.ps1 calls it', () => {
      const before = milestoneCalls().length;
      const r = pwsh(path.join(roadmap(), 'scripts/Get-RoadmapState.ps1'), [], fake.env(), work);
      expect(r.stderr).not.toContain('not found');
      expect(r.status).toBe(0);
      expect(JSON.parse(r.stdout).milestones.map((m: any) => m.title)).toEqual(['M1']);
      expect(milestoneCalls().length).toBeGreaterThan(before);
    });

    it('Set-IssueMilestones.ps1 calls it', () => {
      const before = milestoneCalls().length;
      const assignment = JSON.stringify([{ issue: 5, milestone: 'M1' }]);
      const r = pwsh(
        path.join(roadmap(), 'scripts/Set-IssueMilestones.ps1'),
        ['-Assignment', assignment],
        fake.env(),
        work,
      );
      expect(r.stderr).not.toContain('Get-Milestones.ps1 not found');
      expect(milestoneCalls().length).toBeGreaterThan(before);
    });
  },
);
