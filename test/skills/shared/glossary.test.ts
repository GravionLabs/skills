import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8');
const lineCount = (s: string): number => s.trimEnd().split(/\r?\n/).length;

describe('glossary', () => {
  const skill = read('skills/shared/glossary/SKILL.md');
  const format = read('skills/shared/glossary/references/format.md');

  it('SKILL.md is at most 100 lines and named glossary', () => {
    expect(lineCount(skill)).toBeLessThanOrEqual(100);
    expect(skill).toMatch(/^name: glossary$/m);
  });

  it('format covers term, definition, _Avoid_, relationships, flagged ambiguities', () => {
    for (const s of ['_Avoid_', 'Relates to', 'Flagged ambiguities', 'No implementation details']) {
      expect(format).toContain(s);
    }
    expect(skill).toContain('references/format.md');
  });

  it('creates the file lazily with the first resolved term', () => {
    expect(skill).toMatch(/created lazily with the first resolved term/);
  });

  it('has the grilling rules', () => {
    expect(skill).toMatch(/conflicts with the glossary/);
    expect(skill).toMatch(/canonical term/);
    expect(skill).toMatch(/against the code/);
  });

  it('is registered in the group lists and the trigger evals', () => {
    expect(read('skills/delivery/skills-manage/scripts/groups.json')).toContain('"glossary"');
    expect(read('.claude-plugin/marketplace.json')).toContain('glossary');
    expect(read('README.md')).toContain('`glossary`');
    const evals = JSON.parse(read('evals/skill-triggers.json')) as { skill: string }[];
    expect(evals.some((e) => e.skill === 'glossary')).toBe(true);
  });
});

describe('grill-me --docs', () => {
  const grill = read('skills/delivery/grill-me/SKILL.md');
  it('loads glossary and offers an ADR only under three conditions', () => {
    expect(grill).toContain('--docs');
    expect(grill).toContain('`glossary`');
    expect(grill).toContain('`adr`');
    for (const c of ['hard to reverse', 'surprising without context', 'real trade-off']) {
      expect(grill).toContain(c);
    }
  });
});

describe.each([
  ['planner', 'skills/delivery/planner/SKILL.md'],
  ['code-review', 'skills/shared/code-review/SKILL.md'],
  ['github-pull-request', 'skills/github/github-pull-request/SKILL.md'],
])('%s reads GLOSSARY.md', (_name, file) => {
  const s = read(file);
  it('uses the terms when present and stays silent when absent', () => {
    expect(s).toContain('GLOSSARY.md');
    expect(s).toMatch(/absent: no note, no suggestion to create it/i);
  });
  it('stays within 100 lines', () => {
    expect(lineCount(s)).toBeLessThanOrEqual(100);
  });
});
