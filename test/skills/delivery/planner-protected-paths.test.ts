import * as fs from 'fs';
import * as path from 'path';

const pk = path.resolve(__dirname, '../../../skills');
const read = (p: string) => fs.readFileSync(path.join(pk, p), 'utf-8');

describe('planner protected paths (#752)', () => {
  const list: string[] = JSON.parse(read('delivery/deliver/protected-paths.json'));
  const slicing = read('delivery/planner/references/slicing.md');
  const loop = read('delivery/deliver/scripts/deliver-loop.mts');

  it('the shared default list holds the guarded paths', () => {
    expect(list).toEqual(
      expect.arrayContaining(['.github/', '.agents/', '.claude/', 'package.json']),
    );
  });

  it('the loop reads the shared file and keeps no second copy', () => {
    expect(loop).toContain('protected-paths.json');
    // the comparators are keyed by file name (#967, #970, #971), the list itself is not copied
    expect(loop).not.toContain("'Directory.Packages.props'");
  });

  it('the slicing rules name the config key and the shared file, not a copy', () => {
    const section = slicing.split('## Protected paths')[1];
    expect(section).toContain('deliver.protectedPaths');
    expect(section).toContain('protected-paths.json');
    for (const entry of list) expect(section).not.toContain(`\`${entry}\``);
  });

  it('the slicing rules cut an interactive PBI and advise delivering it first', () => {
    const section = slicing.split('## Protected paths')[1];
    expect(section).toMatch(/own PBI/);
    expect(section).toMatch(/only the files that trigger the guard/);
    expect(section).toContain('`interactive`');
    expect(section).toMatch(/`blocked_by` only when it needs the change/);
    expect(section).toContain('/deliver <nr>');
  });

  it('SKILL.md points to the section and the schema allows labels', () => {
    expect(read('delivery/planner/SKILL.md')).toContain('## Protected paths');
    const schema = JSON.parse(read('delivery/planner/schema/plan.schema.json'));
    expect(JSON.stringify(schema)).toContain('"labels"');
  });
});
