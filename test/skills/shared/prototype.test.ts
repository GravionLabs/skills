import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const dir = path.join(root, 'skills/shared/prototype');
const read = (f: string): string => fs.readFileSync(path.join(dir, f), 'utf-8');
const skill = read('SKILL.md');

describe('prototype skill', () => {
  it('is within 100 lines and model-invocable', () => {
    expect(skill.trimEnd().split('\n').length).toBeLessThanOrEqual(100);
    expect(skill).not.toContain('disable-model-invocation');
  });

  it('picks the branch from the question and points at both references', () => {
    expect(skill).toContain('references/logic.md');
    expect(skill).toContain('references/ui.md');
    expect(fs.existsSync(path.join(dir, 'references/logic.md'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'references/ui.md'))).toBe(true);
  });

  it('states the prototype rules', () => {
    expect(skill).toMatch(/Mark it as a prototype/);
    expect(skill).toMatch(/One command runs it/);
    expect(skill).toMatch(/No persistence by default/);
    expect(skill).toMatch(/No polish/);
    expect(skill).toMatch(/full state after every action/);
  });

  it('ends with the verdict in the issue and a pushed, never merged branch', () => {
    expect(skill).toContain('## Decisions');
    expect(skill).toContain('`prototype/<name>`');
    expect(skill).toMatch(/Never merge it/);
    expect(skill).toMatch(/Link the branch from the issue/);
  });

  it('ui reference switches variants by URL parameter', () => {
    expect(read('references/ui.md')).toContain('?variant=');
  });

  it('is registered in marketplace.json, groups.json and the README', () => {
    const market = fs.readFileSync(path.join(root, '.claude-plugin/marketplace.json'), 'utf-8');
    const groups = JSON.parse(
      fs.readFileSync(
        path.join(root, 'skills/delivery/skills-manage/scripts/groups.json'),
        'utf-8',
      ),
    ) as Record<string, string[]>;
    expect(market).toContain('./skills/shared/prototype');
    expect(groups.shared).toContain('prototype');
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf-8')).toContain('`prototype`');
  });
});
