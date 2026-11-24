import * as fs from 'fs';
import * as path from 'path';
import { expectSkillHelp } from '../../helpers/skill-help';

const root = path.resolve(__dirname, '../../..');
const dir = path.join(root, 'skills/delivery/handoff');
const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
const template = fs.readFileSync(path.join(dir, 'references/template.md'), 'utf-8');

describe('handoff skill', () => {
  it('follows the help convention', () => {
    expectSkillHelp(dir);
  });

  it('is user-invoked and within 100 lines', () => {
    expect(skill).toContain('disable-model-invocation: true');
    expect(skill).toContain("opencode/autoinvoke: 'false'");
    expect(skill.trimEnd().split('\n').length).toBeLessThanOrEqual(100);
  });

  it('names the file pattern, temp dir and absolute path report', () => {
    expect(skill).toContain('handoff-<yyyy-mm-dd>-<slug>.md');
    expect(skill).toContain('OS temp dir');
    expect(skill).toContain('absolute path');
  });

  it('template has the six sections in order', () => {
    const names = ['Goal', 'State', 'Next steps', 'Open decisions', 'Suggested skills', 'Pointers'];
    const at = names.map((n) => template.indexOf(`## ${n}`));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('links instead of copying and redacts', () => {
    expect(skill).toContain('Link, do not copy');
    expect(skill).toContain('<REDACTED>');
    expect(fs.readFileSync(path.join(dir, 'references/redaction.md'), 'utf-8')).toContain(
      '<REDACTED>',
    );
  });

  it('is listed in the marketplace, groups.json and README', () => {
    const mp = fs.readFileSync(path.join(root, '.claude-plugin/marketplace.json'), 'utf-8');
    const groups = fs.readFileSync(
      path.join(root, 'skills/delivery/skills-manage/scripts/groups.json'),
      'utf-8',
    );
    expect(mp).toContain('./skills/delivery/handoff');
    expect(groups).toContain('"handoff"');
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf-8')).toContain('`handoff`');
  });
});
