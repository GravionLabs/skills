import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const workflowDir = path.join(root, '.github/workflows');
const workflows = fs.readdirSync(workflowDir).filter((f) => /\.ya?ml$/.test(f));

describe('supply chain hardening (#730)', () => {
  it('pnpm-workspace.yaml holds back releases younger than 7 days', () => {
    const text = fs.readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf-8');
    expect(text).toMatch(/^minimumReleaseAge: 10080$/m);
  });

  it('the Renovate config extends the shared preset and sets no weaker release age', () => {
    const text = fs.readFileSync(path.join(root, '.github/renovate.json5'), 'utf-8');
    expect(text).toContain('"github>GravionLabs/ci"');
    expect(text).not.toMatch(/minimumReleaseAge/);
  });

  it('a Renovate workflow runs the config of this repository', () => {
    const text = fs.readFileSync(path.join(workflowDir, 'renovate.yml'), 'utf-8');
    expect(text).toContain('configurationFile: .github/renovate.json5');
  });

  it.each(workflows)(
    '%s pins every foreign action to a full commit SHA with the version in a comment',
    (file) => {
      const uses = fs
        .readFileSync(path.join(workflowDir, file), 'utf-8')
        .split('\n')
        .map((l) => l.match(/^\s*-?\s*uses:\s*(\S+)(.*)$/))
        .filter((m): m is RegExpMatchArray => m !== null)
        .filter((m) => !m[1].startsWith('GravionLabs/') && !m[1].startsWith('./'));
      const offenders = uses
        .filter((m) => !/@[0-9a-f]{40}$/.test(m[1]) || !/^\s+#\s*v\d/.test(m[2]))
        .map((m) => m[1]);
      expect(offenders).toEqual([]);
    },
  );
});
