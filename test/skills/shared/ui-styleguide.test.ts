import * as fs from 'fs';
import * as path from 'path';

const dir = path.resolve(__dirname, '../../../skills/shared/ui-styleguide');
const read = (p: string): string => fs.readFileSync(path.join(dir, p), 'utf8');
const lineCount = (s: string): number => s.trimEnd().split(/\r?\n/).length;

const SECTIONS = [
  'Tokens',
  'Color',
  'Typography',
  'Radius and elevation',
  'Components',
  'UX rules',
  'Cross-platform',
  'When this guide is silent',
];
const DEEP_DIVES = ['color.md', 'components.md', 'ux-rules.md'];

describe('ui-styleguide', () => {
  it('SKILL.md is at most 100 lines', () => {
    expect(lineCount(read('SKILL.md'))).toBeLessThanOrEqual(100);
  });

  it('ships the core template and the deep-dive templates', () => {
    for (const f of [
      'STYLEGUIDE.md',
      'agents-styleguide.md',
      ...DEEP_DIVES.map((d) => `styleguide/${d}`),
    ]) {
      expect(fs.existsSync(path.join(dir, 'templates', f)), f).toBe(true);
    }
  });

  describe('templates/STYLEGUIDE.md', () => {
    const core = read('templates/STYLEGUIDE.md');

    it('is at most 100 lines', () => {
      expect(lineCount(core)).toBeLessThanOrEqual(100);
    });

    it.each(SECTIONS)('has the section %s', (s) => {
      expect(core).toMatch(new RegExp(`^## ${s}$`, 'm'));
    });

    it.each(DEEP_DIVES)('links %s with a reading condition', (d) => {
      expect(core).toMatch(
        new RegExp(`^- Read \\[styleguide/${d}\\]\\(styleguide/${d}\\) when `, 'm'),
      );
    });
  });

  it('agents-styleguide.md holds the binding paragraph', () => {
    const p = read('templates/agents-styleguide.md');
    expect(p).toContain('docs/STYLEGUIDE.md');
    expect(p).toMatch(/binding/);
    expect(p).toMatch(/deviation needs a reason in the PR/);
  });
});
