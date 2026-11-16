import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/skills-manage/scripts/Install-Skills.ps1',
);

// Windows setup on Linux CI: Git Bash's HOME (/y/) differs from the profile (USERPROFILE). The seam is
// GRAVIONLABS_TEST_WINDOWS=1; the global dry run shows which home decides what is already installed.
describe.skipIf(!hasPwsh)('Install-Skills.ps1 home directory', () => {
  let tmp: string;
  let profile: string;
  let fakeHome: string;

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sihome-')));
    profile = path.join(tmp, 'profile');
    fakeHome = path.join(tmp, 'y');
    // the base groups' marker skills exist only below the profile
    for (const m of ['detect-techstack', 'github-issue', 'deliver']) {
      fs.mkdirSync(path.join(profile, '.claude', 'skills', m), { recursive: true });
      fs.writeFileSync(path.join(profile, '.claude', 'skills', m, 'SKILL.md'), '');
    }
    fs.mkdirSync(fakeHome);
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const dryRun = (env: Record<string, string>) =>
    spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, '-Global', '-DryRun'], {
      encoding: 'utf8',
      cwd: tmp,
      env: { ...process.env, HOME: fakeHome, USERPROFILE: profile, ...env },
    });

  it('uses USERPROFILE on Windows, so the skills below it count as installed', () => {
    const r = dryRun({ GRAVIONLABS_TEST_WINDOWS: '1' });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('nothing to propose');
  });

  it('uses HOME on Linux/macOS, where the profile directory is not looked at', () => {
    const r = dryRun({ GRAVIONLABS_TEST_WINDOWS: '' });
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain('nothing to propose');
  });
});
