import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const control = fs.readFileSync(
  path.resolve(__dirname, '../../../skills/delivery/deliver/references/control.md'),
  'utf8',
);
const release = control.slice(control.indexOf('## Release'), control.indexOf('## Context guard'));

describe('deliver control.md', () => {
  it('handles the loop result max reached without releasing', () => {
    expect(release).toMatch(/`max reached`/);
    expect(release).toMatch(/delivered count/);
    expect(release).toMatch(/start the loop again/);
  });

  it('lists model for the iteration-start record', () => {
    const row = control.split('\n').find((l) => l.startsWith('| `iteration-start`'));
    expect(row).toMatch(/`model`/);
  });
});

describe('deliver control session for --objective', () => {
  const skill = fs.readFileSync(
    path.resolve(__dirname, '../../../skills/delivery/deliver/SKILL.md'),
    'utf8',
  );
  const objective = control.slice(
    control.indexOf('## Objective'),
    control.indexOf('## Context guard'),
  );

  it('names the option in SKILL.md within the line limit', () => {
    expect(skill).toMatch(/\/deliver --objective <owner>\/<repo>#<nr>/);
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });

  it('documents status block, gates, stop, takeover and release', () => {
    expect(objective).toMatch(/Get-ObjectiveStatus\.ps1 -Objective <ref> -Text/);
    expect(objective).toMatch(/needs you/);
    expect(objective).toMatch(/Gates:.*in the chat/);
    const stop = objective.split('\n').find((l) => l.startsWith('- Stop:')) ?? '';
    expect(stop).toMatch(/deliver-loop release/);
    expect(stop).not.toMatch(/\/stop\b|`stopped`|stop file of/);
    expect(objective).toMatch(/deliver-loop takeover <ref>/);
    expect(objective).toMatch(/deliver-loop release <ref>/);
  });
});
