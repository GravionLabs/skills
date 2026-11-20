import * as fs from 'fs';
import * as path from 'path';

const dir = path.resolve(__dirname, '../../../skills/github/github-pull-request');
const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
const ref = fs.readFileSync(path.join(dir, 'references/risk-and-proof.md'), 'utf-8');
const release = fs.readFileSync(path.join(dir, 'references/release-mode.md'), 'utf-8');

// #829: Risk and Visual proof sections in the PR body
describe('github-pull-request Risk and Visual proof', () => {
  const tpl = skill.slice(skill.indexOf('3. **Body**'), skill.indexOf('4. **Create**'));

  it('the template has Risk after Summary and Visual proof after Verification, in order', () => {
    const i = (h: string) => tpl.indexOf(h);
    expect(i('## Summary')).toBeGreaterThan(-1);
    expect(i('## Risk')).toBeGreaterThan(i('## Summary'));
    expect(i('## Risk')).toBeLessThan(i('## Changes'));
    expect(i('## Visual proof')).toBeGreaterThan(i('## Verification'));
    expect(i('## Visual proof')).toBeLessThan(i('Closes #<issue_number>'));
  });

  it('defaults without input and has no AI-disclosure or ELI5 section', () => {
    expect(tpl).toContain('Risk: not assessed');
    expect(tpl).toContain('N/A: not stated');
    expect(tpl.slice(0, tpl.indexOf('```', 30))).not.toMatch(/ELI5|AI disclosure/i);
  });

  it('the reference defines three levels and the N/A form with a reason', () => {
    for (const l of ['low', 'medium', 'high']) expect(ref).toMatch(new RegExp(`\\| ${l} +\\|`));
    expect(ref).toContain('N/A: <reason>');
    expect(ref).toMatch(/N\/A: no UI change, \w+/);
  });

  it('release mode has neither section', () => {
    expect(release).not.toContain('## Risk');
    expect(release).not.toContain('## Visual proof');
    expect(skill).toMatch(/not in release mode/);
  });

  it('SKILL.md stays within 100 lines', () => {
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });
});
