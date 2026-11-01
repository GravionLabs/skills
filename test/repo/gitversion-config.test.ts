import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';

const root = path.resolve(__dirname, '../..');
const text = fs.readFileSync(path.join(root, 'GitVersion.yml'), 'utf-8');
const config = parse(text);
const ci = parse(fs.readFileSync(path.join(root, '.github/workflows/ci.yml'), 'utf-8'));

// #102: the bump comes from the Conventional Commits of determine-version (GravionLabs/ci#107), not from GitVersion.yml.
describe('GitVersion.yml', () => {
  it('lets the tags decide the version instead of a fixed next-version', () => {
    expect(config['next-version']).toBeUndefined();
  });

  it('keeps ContinuousDeployment and the release/next branch regex', () => {
    expect(config.mode).toBe('ContinuousDeployment');
    expect(config.branches.release.regex).toBe('^release/next$');
  });

  it.each([
    'major-version-bump-message',
    'minor-version-bump-message',
    'patch-version-bump-message',
  ])('overrides no %s, so the Conventional Commit rules of determine-version apply', (key) => {
    expect(config[key]).toBeUndefined();
  });

  it('has no release merge-message hack and no fixed increment on release/next', () => {
    expect(text).not.toContain('Merge pull request');
    expect(config.branches.release.increment).toBeUndefined();
  });
});

describe('determine-version in ci.yml', () => {
  const step = ci.jobs['determine-version'].steps.find((s: { id?: string }) => s.id === 'version');

  it('uses the GravionLabs/ci release with the Conventional Commit versioning and this config', () => {
    expect(step.uses).toBe('GravionLabs/ci/versioning/determine-version@v1.5.0');
    expect(step.with['gitversion-config-file']).toBe('GitVersion.yml');
  });

  it('does not turn the Conventional Commit bump off', () => {
    expect(step.with['conventional-commits']).toBeUndefined();
  });
});
