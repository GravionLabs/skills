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
