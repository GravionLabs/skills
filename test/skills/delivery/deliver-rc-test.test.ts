import * as fs from 'fs';
import * as path from 'path';

const dir = path.resolve(__dirname, '../../../skills/delivery/deliver');
const read = (f: string) => fs.readFileSync(path.join(dir, f), 'utf8');

// #378: step 9 cuts the RC and opens the release PR without waiting for the RC test.
describe('deliver step 9: RC test', () => {
  const skill = read('SKILL.md');
  const review = read('references/release-review.md');

  it('the release-test issue does not block step 9; gate true stops after the RC', () => {
    expect(skill).toContain('except the `release-test` issue');
    expect(skill).toContain('`release.test.gate: true` stops there with `needs you: RC test');
    expect(skill).toContain('needs you: RC test <issue URL>, release PR <URL>');
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });

  it('documents the RC comment marker, replace of older issues, new RC after a bug and the gate default', () => {
    expect(review).toContain('<!-- release-test-rc -->');
    expect(review).toContain('olderReleaseTests');
    expect(review).toContain('no second release review');
    expect(review).toContain('Superseded by <issue URL> (RC <version>).');
    expect(review).toContain('cuts a new RC and posts it on the same issue');
    expect(review).toContain('`release.test.gate` (default `false`)');
    expect(review).toContain('`release.prerelease`');
    expect(review).toContain('`rcUrl`');
  });

  it('the control session does not wait for the RC test', () => {
    expect(read('references/control.md')).toContain('does not wait for the RC test');
  });

  // #398: the release-test issue is never delivered as work.
  it('never selects the release-test issue as work, also not interactively or in the control session', () => {
    expect(skill).toContain(
      'is never selected as work, not in steps 1 to 8 and not in the control session',
    );
    expect(skill).toContain('release test, left for step 9');
    expect(skill).not.toContain('is selected only when it is the last open');
    expect(read('references/control.md')).toContain(
      'never the `release-test` issue, it stays open for step 9',
    );
  });
});
