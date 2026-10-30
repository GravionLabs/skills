import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const read = (p: string): string => readFileSync(path.join(root, p), 'utf8');
const doc = read('docs/usage/project-config.md');

describe('docs/usage/project-config.md', () => {
  it('contains the JetBrains example', () => {
    expect(doc).toContain('dotnet tool install -g JetBrains.ReSharper.GlobalTools');
    expect(doc).toContain('jb cleanupcode');
    expect(doc).toContain('jb inspectcode');
    expect(doc).toContain('git diff --exit-code');
  });
  it('documents precedence, errors and the gitignore note', () => {
    expect(doc).toMatch(/replaces all default commands/i);
    expect(doc).toMatch(/not installed is an error/i);
    expect(doc).toMatch(/^\.agents\/\*$/m);
    expect(doc).toMatch(/^!\.agents\/config\.json$/m);
  });
  it('is linked from README and the site sidebar', () => {
    expect(read('README.md')).toContain('docs/usage/project-config.md');
    expect(read('site/.vitepress/sidebar.ts')).toContain('/usage/project-config');
  });
  it('is mentioned by the implementation skill and stays within 100 lines', () => {
    const s = read('skills/implementation/SKILL.md');
    expect(s).toContain('.agents/config.json');
    expect(s.split('\n').length).toBeLessThanOrEqual(100);
  });
  it('implementation Before commit has separate targeted and full-run items', () => {
    const s = read('skills/implementation/SKILL.md');
    expect(s).toMatch(/^- \[ \] Build passes .*never the full suite\)$/m);
    expect(s).toMatch(
      /^- \[ \] Full suite: one full run before the pull request, and again after the last fix round$/m,
    );
  });
  it('skills link the override doc by full URL, not a relative docs/ path', () => {
    const f = read('skills/implementation/references/format.md');
    expect(f).toContain(
      'https://github.com/GravionLabs/skills/blob/main/docs/usage/project-config.md',
    );
    expect(f).not.toMatch(/(^|[^/])docs\/usage\//m);
  });
});
