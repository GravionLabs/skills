import * as fs from 'fs';
import * as path from 'path';

// Names and descriptions that apm-hub 3.x removed stay removed (apm-hub #766, #774)
const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');
const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.name === 'node_modules') return [];
    return e.isDirectory() ? walk(p) : [p];
  });

describe('removed names are gone from skills and AGENTS.md', () => {
  const files = [...walk(path.join(root, 'skills')), path.join(root, 'AGENTS.md')].filter(
    (f) => !/\.(png|jpg|ico|zip)$/.test(f),
  );
  const content = (f: string) => fs.readFileSync(f, 'utf-8');
  it.each([
    'verify-project',
    'Final-Verify',
    'git-cliff changelog setup',
    'batch implementation',
    'model-policy',
    'batch-workflow',
    'subagent_type: explorer',
  ])('%s', (needle) => {
    const hits = files
      .filter((f) => content(f).includes(needle))
      .map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
  });
});

describe('skill descriptions', () => {
  it('ng-implementation says Angular 21+', () => {
    expect(read('skills/ng-implementation/SKILL.md')).toMatch(/^description: 'Angular 21\+/m);
  });

  it('diagnose and retro name no removed role', () => {
    expect(read('skills/diagnose/SKILL.md')).not.toContain('As implementer');
    expect(read('skills/diagnose/SKILL.md')).toContain('As a subagent');
    const retro = read('skills/retro/SKILL.md');
    expect(/^description: (.*)$/m.exec(retro)![1]).not.toContain('orchestrator run');
    expect(retro).toContain('run or session');
  });

  it('implementation asks for one full run before the pull request', () => {
    expect(read('skills/implementation/SKILL.md')).toContain(
      'one full run before the pull request',
    );
  });
});
