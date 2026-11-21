import * as fs from 'fs';
import * as path from 'path';

const dir = path.resolve(__dirname, '../../../skills/shared/agents-md');
const read = (p: string): string => fs.readFileSync(path.join(dir, p), 'utf8');
const lineCount = (s: string): number => s.trimEnd().split(/\r?\n/).length;

const BUDGET = 8000;
const SECTIONS = ['Checks', 'Repo rules', 'Code style', 'Footguns', 'Read before'];

describe('agents-md', () => {
  const skill = read('SKILL.md');

  it('SKILL.md is at most 100 lines', () => {
    expect(lineCount(skill)).toBeLessThanOrEqual(100);
  });

  it('states the budget, the reference-file rule and the admission rule', () => {
    expect(skill).toContain('8 000 characters');
    expect(skill).toMatch(/Admission rule/);
    expect(skill).toMatch(/non-obvious/);
    expect(skill).toMatch(/repeatedly encountered/);
    expect(skill).toMatch(/specific enough to act on/);
    expect(skill).toContain('Suggested AGENTS.md additions');
    expect(skill).toContain('docs/agents-md-refs/');
  });

  it.each(['references/budget.md', 'references/ref-files.md', 'templates/AGENTS.md'])(
    'ships and links %s',
    (f) => {
      expect(fs.existsSync(path.join(dir, f)), f).toBe(true);
      expect(skill).toContain(f);
    },
  );

  it('budget.md states the limit and ref-files.md the one-topic rule', () => {
    expect(read('references/budget.md')).toContain('8 000');
    expect(read('references/ref-files.md')).toMatch(/One topic per file/);
    expect(read('references/ref-files.md')).toMatch(/No file is read unconditionally/);
  });

  describe('templates/AGENTS.md', () => {
    const tpl = read('templates/AGENTS.md');

    it('is within the budget', () => {
      expect(tpl.length).toBeLessThanOrEqual(BUDGET);
    });

    it.each(SECTIONS)('has the section %s', (s) => {
      expect(tpl).toMatch(new RegExp(`^## ${s}$`, 'm'));
    });

    it('names its reference files with a reading condition', () => {
      expect(tpl).toMatch(/^- Before .+, read `docs\/agents-md-refs\/.+\.md`\./m);
    });
  });
});
