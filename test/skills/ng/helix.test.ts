import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../../skills/ng/ng-implementation');
const referencePath = path.join(root, 'references/helix.md');
const skill = readFileSync(path.join(root, 'SKILL.md'), 'utf8');
const reference = readFileSync(referencePath, 'utf8');

// body rows of the mapping table: without the header and the delimiter row
const rows = reference
  .split('\n')
  .filter((line) => line.startsWith('|'))
  .slice(2)
  .map((line) => line.split('|').map((cell) => cell.trim()));

// selectors of @gravionlabs/helix-ui 22.7
const selector =
  /`(button\[hx-button\]|(input|textarea)\[hx-input\]|input\[type="checkbox"\]\[hx-(checkbox|switch)\]|hx-(select|input-group|message|fieldset|progress-bar)|hxDialogFooter)`/;

describe('ng-implementation Helix reference', () => {
  it('exists', () => {
    expect(existsSync(referencePath)).toBe(true);
  });
  it('is linked from SKILL.md with its reading condition', () => {
    expect(skill).toMatch(/depends on `@gravionlabs\/helix-ui` → read `references\/helix\.md`/);
  });
  it('forbids raw controls and control styles', () => {
    for (const element of ['button', 'input', 'select', 'textarea', 'progress'])
      expect(reference).toContain(`\`<${element}>\``);
    expect(reference).toContain('No component CSS that styles controls');
  });
  it('names a Helix selector in every table row', () => {
    expect(rows).toHaveLength(13);
    for (const [, need, use] of rows) expect(use, need).toMatch(selector);
  });
  it('links the UX rules and the style guide of the project', () => {
    expect(reference).toContain('https://github.com/GravionLabs/helix/blob/main/docs/UX-RULES.md');
    expect(reference).toContain('`docs/STYLEGUIDE.md`');
  });
});
