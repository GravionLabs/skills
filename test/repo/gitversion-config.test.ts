import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const file = path.resolve(__dirname, '../../GitVersion.yml');
const config = parse(fs.readFileSync(file, 'utf-8'));
const minorBump = new RegExp(config['minor-version-bump-message'], 'm');

describe('GitVersion.yml', () => {
  it('lets the tags decide the version instead of a fixed next-version', () => {
    expect(config['next-version']).toBeUndefined();
  });

  it.each(['Merge pull request #70 from GravionLabs/release/next', '+semver: minor'])(
    'bumps the minor version for %s',
    (message) => {
      expect(minorBump.test(message)).toBe(true);
    },
  );

  it.each(['Merge pull request #71 from GravionLabs/hotfix/x', 'feat(x): y (#5)'])(
    'does not bump the minor version for %s',
    (message) => {
      expect(minorBump.test(message)).toBe(false);
    },
  );
});
