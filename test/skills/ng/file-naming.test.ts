import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const dir = path.resolve(__dirname, '../../../skills/ng/ng-implementation');
const read = (file: string): string => readFileSync(path.join(dir, file), 'utf8');
const section = (text: string, heading: string): string =>
  text.split(`\n## ${heading}`)[1]?.split('\n## ')[0] ?? '';

describe('ng-implementation file naming', () => {
  it('takes the convention from the angular.json schematics settings', () => {
    const naming = section(read('SKILL.md'), 'File naming');
    expect(naming).toContain('`schematics`');
    expect(naming).toContain('`"type"`');
    expect(naming).toContain('`"typeSeparator": "."`');
    for (const kind of [
      'component',
      'directive',
      'service',
      'guard',
      'interceptor',
      'module',
      'pipe',
      'resolver',
    ]) {
      expect(naming).toMatch(new RegExp(`\`(@schematics/angular)?:${kind}\``));
    }
  });
  it('points the component scaffold to the same rule', () => {
    const naming = section(read('references/component.md'), 'File naming');
    expect(naming).toContain('"File naming" in `SKILL.md`');
    expect(naming).toContain('`schematics` in `angular.json`');
    expect(naming).toContain('`"type": "component"`');
  });
  it('reviews naming that differs from angular.json or shadows a global', () => {
    expect(section(read('SKILL.md'), 'Review rules')).toMatch(
      /🟡 .*differently from what `angular\.json`.*declares.*shadows a DOM\/JS global/,
    );
  });
});
