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
    expect(read('skills/ng/ng-implementation/SKILL.md')).toMatch(/^description: 'Angular 21\+/m);
  });

  it('diagnose and retro name no removed role', () => {
    expect(read('skills/shared/diagnose/SKILL.md')).not.toContain('As implementer');
    expect(read('skills/shared/diagnose/SKILL.md')).toContain('As a subagent');
    const retro = read('skills/delivery/retro/SKILL.md');
    expect(/^description: (.*)$/m.exec(retro)![1]).not.toContain('orchestrator run');
    expect(retro).toContain('run or session');
  });

  it('implementation asks for one full run before the pull request', () => {
    expect(read('skills/shared/implementation/SKILL.md')).toContain(
      'one full run before the pull request',
    );
  });
});

describe('apm-hub leftovers (#163)', () => {
  // The site code and the concept pages; the other pages (moved from docs/ in #493) may name apm-hub as history.
  it('the site code and site/concepts/ do not mention apm-hub', () => {
    const concepts = path.join(root, 'site', 'concepts');
    const files = walk(path.join(root, 'site')).filter(
      (f) =>
        /\.(md|json|ts|mts|js|mjs|vue|css)$/.test(f) &&
        !/[\\/](dist|cache)[\\/]/.test(f) &&
        (!f.endsWith('.md') ||
          f.startsWith(concepts) ||
          f === path.join(root, 'site', 'README.md')),
    );
    expect(files).toContain(path.join(concepts, 'skills.md'));
    const hits = files
      .filter((f) => fs.readFileSync(f, 'utf-8').includes('apm-hub'))
      .map((f) => path.relative(root, f));
    expect(hits).toEqual([]);
  });

  it('the site package names the GravionLabs skills documentation site', () => {
    expect(JSON.parse(read('site/package.json')).description).toBe(
      'The GravionLabs skills documentation site (VitePress).',
    );
  });

  it('the skills concept page names no agents package', () => {
    expect(read('site/concepts/skills.md')).not.toContain('`agents` package');
  });
});
