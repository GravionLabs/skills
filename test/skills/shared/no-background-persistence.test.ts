import * as fs from 'fs';
import * as path from 'path';

const shared = path.resolve(__dirname, '../../../skills/shared');
const read = (p: string) => fs.readFileSync(path.join(shared, p), 'utf-8');

describe('no background persistence', () => {
  const ref = read('implementation/references/no-background-persistence.md');

  // The reference is the single source of the forbidden list and the exception path.
  const mechanisms = [
    'schtasks',
    'Register-ScheduledTask',
    'New-Service',
    'sc create',
    'Run` keys',
    'RunOnce',
    'autostart',
    'LaunchAgent',
    'LaunchDaemon',
    'systemd',
    'cron',
    'startup-folder',
    'startup shortcut',
    'accepted ADR',
  ];

  it('implementation states the rule and links the reference', () => {
    const s = read('implementation/SKILL.md');
    expect(s).toContain('## No background persistence');
    expect(s).toContain('references/no-background-persistence.md');
  });

  it.each(mechanisms)('implementation SKILL.md does not repeat the list (%s)', (item) => {
    expect(read('implementation/SKILL.md')).not.toContain(item);
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

  it('code-review points to the reference and reports a forbidden mechanism as blocking', () => {
    const s = read('code-review/SKILL.md');
    expect(s).toContain('## Background persistence');
    expect(s).toContain('is blocking, unless the exception there applies');
    expect(s).toContain('`implementation` `references/no-background-persistence.md`');
  });

  it.each(mechanisms)('code-review SKILL.md does not repeat the list (%s)', (item) => {
    expect(read('code-review/SKILL.md')).not.toContain(item);
  });
});
