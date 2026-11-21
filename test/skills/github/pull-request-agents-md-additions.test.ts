import * as fs from 'fs';
import * as path from 'path';

const skill = fs.readFileSync(
  path.resolve(__dirname, '../../../skills/github/github-pull-request/SKILL.md'),
  'utf-8',
);

// #828: agents propose AGENTS.md rules in the PR body, a person decides
describe('github-pull-request Suggested AGENTS.md additions', () => {
  it('the body template carries the section before the footer', () => {
    const tpl = skill.slice(skill.indexOf('3. **Body**'), skill.indexOf('4. **Create**'));
    const sec = tpl.indexOf('## Suggested AGENTS.md additions');
    expect(sec).toBeGreaterThan(-1);
    expect(sec).toBeLessThan(tpl.indexOf('Closes #<issue_number>'));
  });

  it('says the section is optional, omitted when empty, and never edits AGENTS.md', () => {
    expect(skill).toMatch(/optional: omit it when empty/);
    expect(skill).toMatch(/never edits `AGENTS\.md`/);
  });

  it('SKILL.md stays within 100 lines', () => {
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });
});
