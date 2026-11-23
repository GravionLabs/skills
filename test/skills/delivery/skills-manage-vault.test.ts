import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/delivery/skills-manage/scripts/Install-Skills.ps1',
);

describe.skipIf(!hasPwsh)('Install-Skills.ps1 notes vaults', () => {
  let tmp: string;
  let home: string;

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'sivault-')));
    home = path.join(tmp, 'home');
    for (const m of ['detect-techstack', 'github-issue', 'deliver']) {
      fs.mkdirSync(path.join(home, '.claude', 'skills', m), { recursive: true });
      fs.writeFileSync(path.join(home, '.claude', 'skills', m, 'SKILL.md'), '');
    }
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const project = (name: string, files: string[]) => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const f of files) {
      if (f.endsWith('/')) fs.mkdirSync(path.join(dir, f), { recursive: true });
      else fs.writeFileSync(path.join(dir, f), '');
    }
    return dir;
  };
  const dry = (cwd: string, args: string[] = []) => {
    const r = spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, '-DryRun', ...args], {
      encoding: 'utf8',
      cwd,
      env: { ...process.env, HOME: home },
    });
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout) as { groups: string[]; wouldInstall: string[] };
  };

  it('proposes vault for a .obsidian folder without build file', () => {
    const r = dry(project('obs', ['.obsidian/']));
    expect(r.groups).toEqual(['vault']);
    expect(r.wouldInstall).toContain('vault-inbox');
  });

  it('proposes vault and school for a .nixe vault with Profile.md', () => {
    const r = dry(project('nixe', ['.nixe/', 'Profile.md']));
    expect(r.groups).toEqual(['vault', 'school']);
    expect(r.wouldInstall).toContain('school-exam');
  });

  it('proposes nothing for a vault-like folder with a build file', () => {
    expect(dry(project('built', ['.obsidian/', 'package.json'])).groups).toEqual([]);
    expect(dry(project('built2', ['.nixe/', 'App.csproj'])).groups).toEqual([]);
  });

  it('proposes no vault group without a vault folder', () => {
    expect(dry(project('plain', ['Profile.md'])).groups).toEqual([]);
  });

  it('keeps vault and school out of core and all', () => {
    for (const preset of ['core', 'all']) {
      const r = dry(project(`p-${preset}`, []), ['-Groups', preset]);
      expect(r.groups).not.toContain('vault');
      expect(r.groups).not.toContain('school');
      expect(r.wouldInstall.some((s) => /^(vault|school)-/.test(s))).toBe(false);
    }
  });

  it('installs vault and school by name', () => {
    const r = dry(project('named', []), ['-Groups', 'vault,school']);
    expect(r.groups).toEqual(['vault', 'school']);
  });
});
