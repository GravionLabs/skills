import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');

function listFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listFiles(full);
    return /\.(ya?ml|md|ts)$/.test(entry.name) ? [full] : [];
  });
}

// The ref after @ (letters, digits, dots, dashes); quotes, backticks and escapes end it.
const ciRef = /GravionLabs\/ci\/[A-Za-z0-9_./-]+@[\w.-]*/g;

describe('GravionLabs/ci is followed on the major tag v1 (#114)', () => {
  const files = ['.github', 'skills', 'test'].flatMap((dir) => listFiles(path.join(root, dir)));

  it('finds GravionLabs/ci references to check', () => {
    const refs = files.flatMap((f) => fs.readFileSync(f, 'utf-8').match(ciRef) ?? []);
    expect(refs.length).toBeGreaterThan(10);
  });

  it('references GravionLabs/ci only at @v1, never @main, a full version or a SHA', () => {
    const offenders = files.flatMap((f) =>
      (fs.readFileSync(f, 'utf-8').match(ciRef) ?? [])
        .filter((ref) => !ref.endsWith('@v1'))
        .map((ref) => `${path.relative(root, f)}: ${ref}`),
    );
    expect(offenders).toEqual([]);
  });

  it.each([
    ['skills/ts/ts-create-project/templates/.github/workflows/ci.yml', 'node-package.yml'],
    ['skills/py/py-create-project/templates/.github/workflows/ci.yml', 'python-package.yml'],
  ])('%s calls the existing reusable workflow %s', (rel, workflow) => {
    const text = fs.readFileSync(path.join(root, rel), 'utf-8');
    expect(text).toContain(`uses: GravionLabs/ci/.github/workflows/${workflow}@v1`);
  });

  it.each([
    'skills/ts/ts-create-project/SKILL.md',
    'skills/py/py-create-project/SKILL.md',
    'skills/dotnet/dotnet-create-solution/SKILL.md',
    'skills/github/github-release/SKILL.md',
    'skills/shared/implementation/SKILL.md',
  ])('%s states the major-tag rule', (rel) => {
    const text = fs.readFileSync(path.join(root, rel), 'utf-8');
    expect(text).toContain('`GravionLabs/ci` at the major tag `@v<major>`');
    expect(text).toContain('never `@main` or a commit SHA');
  });
});
