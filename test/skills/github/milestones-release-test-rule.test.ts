import * as fs from 'fs';
import * as path from 'path';

const doc = fs.readFileSync(
  path.resolve(__dirname, '../../../skills/github/github-issue/references/milestones.md'),
  'utf8',
);

// #412: the release-test rule follows #398: step 9 cuts the RC, deliver never selects the issue as work.
describe('milestones.md release-test rule', () => {
  it('says deliver never selects the release-test issue and step 9 cuts the RC', () => {
    expect(doc).toMatch(/never selects it as work/);
    expect(doc).toMatch(/step 9 cuts the RC/);
  });

  it('no longer says deliver selects it as the last open item', () => {
    expect(doc).not.toMatch(/selects it only when it is the last open/);
  });
});
