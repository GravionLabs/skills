import * as fs from 'fs';
import * as path from 'path';

const skillDir = path.resolve(__dirname, '../../../skills/shared/implementation');
const read = (p: string) => fs.readFileSync(path.join(skillDir, p), 'utf-8');

describe('spec rules of implementation', () => {
  const ref = read('references/specs.md');

  it('states the rules', () => {
    expect(ref).toContain('governance.specMap');
    expect(ref).toContain('same commit');
    expect(ref).toContain('refactorings, tests, internal renames');
    expect(ref).toContain('<specDir>/<name>.md');
    expect(ref).toContain('`<folder>/**`');
    expect(ref).toContain('`specMode` does not change what implementation does');
  });

  it('has the exact note wording, also in the runner contract', () => {
    const note = 'no spec change needed: <spec file> — <reason>';
    expect(ref).toContain(note);
    expect(read('references/runner-contract.md')).toContain(note);
  });

  it('template has the seven sections', () => {
    const t = read('templates/spec.md');
    expect(t).toMatch(/^# <Service> spec \(<stack>\)/);
    const h = [...t.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
    expect(h).toEqual([
      'Owner',
      'Responsibilities',
      'API',
      'Authentication',
      'Logging',
      'Configuration',
      'Open questions',
    ]);
  });

  it('SKILL.md links the reference and stays within 100 lines', () => {
    const s = read('SKILL.md');
    expect(s).toContain('references/specs.md');
    expect(s.trimEnd().split('\n').length).toBeLessThanOrEqual(100);
  });
});
