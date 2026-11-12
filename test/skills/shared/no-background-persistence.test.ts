import * as fs from 'fs';
import * as path from 'path';

const shared = path.resolve(__dirname, '../../../skills/shared');
const read = (p: string) => fs.readFileSync(path.join(shared, p), 'utf-8');

describe('no background persistence', () => {
  const ref = read('implementation/references/no-background-persistence.md');

  it('implementation states the rule and links the reference', () => {
    const s = read('implementation/SKILL.md');
    expect(s).toContain('## No background persistence');
    expect(s).toContain('references/no-background-persistence.md');
    expect(s).toContain('accepted ADR');
  });

  it.each([
    'schtasks',
    'Register-ScheduledTask',
    'Task Scheduler COM',
    '`Run` and `RunOnce` registry keys',
    'tauri-plugin-autostart',
    'New-Service',
    'sc create',
    'LaunchAgents',
    'LaunchDaemons',
    'systemd `--user`',
    'cron entries',
    'startup-folder shortcuts',
  ])('reference forbids %s', (item) => {
    expect(ref).toContain(item);
  });

  it('reference defines the exception path', () => {
    expect(ref).toContain('accepted ADR');
    expect(ref).toContain('explicit approval of the owner');
    expect(ref).toContain('NSIS_HOOK_PREUNINSTALL');
    expect(ref).toContain('signed binaries');
    expect(ref).toContain('native NSIS commands');
  });

  it('code-review reports it as blocking unless an ADR is referenced', () => {
    const s = read('code-review/SKILL.md');
    expect(s).toContain('## Background persistence');
    expect(s).toContain('is blocking, unless it references an accepted ADR');
    expect(s).toContain('references/no-background-persistence.md');
  });
});
