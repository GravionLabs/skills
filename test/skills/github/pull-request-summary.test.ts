import * as fs from 'fs';
import * as path from 'path';

const dir = path.resolve(__dirname, '../../../skills/github/github-pull-request');
const skill = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
const ref = fs.readFileSync(path.join(dir, 'references/summary.md'), 'utf-8');

// #953: Summary as the smallest visual
describe('github-pull-request summary form', () => {
  it('SKILL.md names the reference for ## Summary', () => {
    const tpl = skill.slice(skill.indexOf('3. **Body**'), skill.indexOf('4. **Create**'));
    expect(tpl).toContain('references/summary.md');
  });

  it('the reference lists the forms, the limits and the credits', () => {
    for (const f of ['Pseudocode', 'Call tree', 'file tree', '`diff`', 'Mermaid'])
      expect(ref).toContain(f);
    expect(ref).toMatch(/one or two visuals/);
    expect(ref).toMatch(/one-line change keeps a one-line summary/);
    expect(ref).toContain('Release mode is unchanged');
    expect(ref).toContain('Dex Horthy');
  });
});
