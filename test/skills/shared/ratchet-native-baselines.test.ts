import * as fs from 'node:fs';
import * as path from 'node:path';

const skill = path.resolve(__dirname, '../../../skills/shared/ratchet');

describe('ratchet native baselines reference', () => {
  const ref = fs.readFileSync(path.join(skill, 'references/native-baselines.md'), 'utf8');
  const md = fs.readFileSync(path.join(skill, 'SKILL.md'), 'utf8');

  it('is linked from SKILL.md with the order native first', () => {
    expect(md).toContain('references/native-baselines.md');
    expect(md).toMatch(/native baseline[^\n]*first[^\n]*own ratchet script second/);
  });

  it('covers the three tools, their versions and the stale-entry snippet', () => {
    for (const s of [
      'eslint-suppressions.json',
      '--baseline-mode shrink-only',
      'TypeScript 7.1',
      'FreezingArchRule.Freeze',
      '0.13.5',
      'git diff --exit-code',
      'Betterer',
      '5.4.0',
      '#1255',
    ]) {
      expect(ref).toContain(s);
    }
  });

  it('keeps SKILL.md within 100 lines', () => {
    expect(md.split('\n').length).toBeLessThanOrEqual(100);
  });
});
