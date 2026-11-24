import * as fs from 'fs';
import * as path from 'path';

const pk = path.resolve(__dirname, '../../../skills');
const read = (p: string) => fs.readFileSync(path.join(pk, p), 'utf-8');
const dir = 'delivery/planner/references';

describe('planner test seams (#956)', () => {
  it('slicing.md has a Test seams section with the three rules', () => {
    const sec = read(`${dir}/slicing.md`).split('## Test seams')[1].split('\n## ')[0];
    expect(sec).toMatch(/Existing seam first/);
    expect(sec).toMatch(/Highest seam possible/);
    expect(sec).toMatch(/Few seams/);
  });

  it('a new seam yields a question with the existing seam as recommended option', () => {
    const sec = read(`${dir}/slicing.md`).split('## Test seams')[1].split('\n## ')[0];
    expect(sec).toMatch(/no existing test at that interface/);
    expect(sec).toMatch(/`questions\[\]`/);
    expect(sec).toMatch(/existing one is `recommended`/);
  });

  it('plan-schema.md documents items[].seam and the Tests line', () => {
    const row = read(`${dir}/plan-schema.md`)
      .split('\n')
      .find((l) => l.startsWith('| `items[].seam`'))!;
    expect(row).toContain('Tests: <seam>');
    expect(row).toMatch(/String/);
  });

  it('SKILL.md step 5 points to the seams section', () => {
    expect(read('delivery/planner/SKILL.md')).toContain('`## Test seams`');
  });

  it('test-quality.md names the seam of the issue', () => {
    expect(read('shared/implementation/references/test-quality.md')).toMatch(
      /seam of the issue[\s\S]*Tests: <seam>/,
    );
  });
});
