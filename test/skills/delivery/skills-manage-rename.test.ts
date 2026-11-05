import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const doc = fs.readFileSync(
  path.resolve(__dirname, '../../../skills/delivery/skills-manage/references/after-install.md'),
  'utf8',
);
const section = doc.split(/^## /m).find((s) => s.startsWith('Renamed skills')) ?? '';

describe('skills-manage after-install: renamed skills', () => {
  it('has a Renamed skills section', () => {
    expect(section).not.toBe('');
  });

  it('names the ng-ag-grid rename with the release and the remove/add steps', () => {
    expect(section).toContain('| `ng-ag-grid-developer` | `ng-ag-grid`');
    expect(section).toContain('v2.0.0');
    expect(section).toContain('npx skills remove ng-ag-grid-developer');
    expect(section).toContain('npx skills add GravionLabs/skills --skill ng-ag-grid');
  });

  it('says why update is not enough and links the rename policy', () => {
    expect(section).toContain('cannot follow a rename');
    expect(section).toContain('CONTRIBUTING.md#public-surface-and-renames');
  });
});
