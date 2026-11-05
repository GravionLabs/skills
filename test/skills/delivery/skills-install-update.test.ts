import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const SRC = path.resolve(__dirname, '../../../skills/delivery/skills-install/scripts');

// Fake npx on PATH records its calls; "skills update" adds `roadmap` to groups.json like a release would.
describe.skipIf(!hasPwsh || process.platform === 'win32')('Install-Skills.ps1 -Update', () => {
  let tmp: string;
  let script: string;
  let log: string;

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'siupd-')));
    const scripts = path.join(tmp, 'skill', 'scripts');
    fs.mkdirSync(scripts, { recursive: true });
    fs.copyFileSync(path.join(SRC, 'Install-Skills.ps1'), path.join(scripts, 'Install-Skills.ps1'));
    script = path.join(scripts, 'Install-Skills.ps1');
    const groups = JSON.parse(fs.readFileSync(path.join(SRC, 'groups.json'), 'utf8'));
    const withRoadmap = JSON.stringify(groups);
    groups.delivery = groups.delivery.filter((s: string) => s !== 'roadmap');
    fs.writeFileSync(path.join(scripts, 'groups.json'), JSON.stringify(groups));
    fs.writeFileSync(path.join(tmp, 'new-groups.json'), withRoadmap);
    const { delivery: _removed, ...withoutDelivery } = JSON.parse(withRoadmap);
    fs.writeFileSync(path.join(tmp, 'no-delivery-groups.json'), JSON.stringify(withoutDelivery));
    const home = path.join(tmp, 'home');
    for (const s of ['deliver', 'github-issue']) {
      fs.mkdirSync(path.join(home, '.claude', 'skills', s), { recursive: true });
      fs.writeFileSync(path.join(home, '.claude', 'skills', s, 'SKILL.md'), '');
    }
    log = path.join(tmp, 'npx.log');
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, 'npx'),
      `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in
  *"skills check"*) echo "deliver  update available"; exit \${FAKE_CHECK_EXIT:-1};;
  *"skills update"*) cp "${tmp}/\${FAKE_NEW_GROUPS:-new-groups.json}" "${scripts}/groups.json";;
esac
exit \${FAKE_UPDATE_EXIT:-0}
`,
      { mode: 0o755 },
    );
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const run = (args: string[], env: Record<string, string> = {}) => {
    fs.writeFileSync(log, '');
    return spawnSync('pwsh', ['-NoProfile', '-File', script, '-Update', ...args], {
      encoding: 'utf8',
      cwd: tmp,
      env: {
        ...process.env,
        HOME: path.join(tmp, 'home'),
        PATH: `${path.join(tmp, 'bin')}${path.delimiter}${process.env.PATH}`,
        ...env,
      },
    });
  };

  it('dry run shows the check output and the update command, updates nothing', () => {
    const r = run(['-DryRun', '-Global']);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.check).toEqual(['deliver  update available']);
    expect(j.commands).toEqual(['npx -y skills update -g']);
    expect(j.updated).toBe(false);
    expect(fs.readFileSync(log, 'utf8')).not.toContain('skills update');
  });

  it('treats check exit 0 (nothing to update) as success, without a note', () => {
    const r = run(['-Global'], { FAKE_CHECK_EXIT: '0' });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).notes).toEqual([]);
  });

  it('fails without updating when check exits 2', () => {
    const r = run(['-Global'], { FAKE_CHECK_EXIT: '2' });
    expect(r.status).toBe(1);
    expect(JSON.parse(r.stdout).notes[0]).toContain('check failed (exit 2)');
    expect(fs.readFileSync(log, 'utf8')).not.toContain('skills update');
  });

  it('updates, then proposes the member that is new in the refreshed group definition', () => {
    const r = run(['-Global']);
    expect(r.status).toBe(0);
    const j = JSON.parse(r.stdout);
    expect(j.updated).toBe(true);
    expect(fs.readFileSync(log, 'utf8')).toContain('-y skills update -g');
    expect(j.newMembers).toContain('roadmap');
    expect(j.newMemberCommands[0]).toContain('--skill roadmap');
  });

  it('fails with a note (exit code, stderr) and no null entries when the new-member child fails', () => {
    // the refreshed groups.json no longer has `delivery`, which the parent still derives from the old map
    const r = run(['-Global'], { FAKE_NEW_GROUPS: 'no-delivery-groups.json' });
    expect(r.status).toBe(1);
    const j = JSON.parse(r.stdout);
    expect(j.notes.join('\n')).toMatch(
      /new-member check after the update failed \(exit 1\): .*delivery/s,
    );
    expect(j.newMembers).toEqual([]);
    expect(j.newMemberCommands).toEqual([]);
  });
});
