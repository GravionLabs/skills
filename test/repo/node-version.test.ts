import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf-8');

describe('Node version of the repository (#72)', () => {
  it('.nvmrc is 26', () => {
    expect(read('.nvmrc').trim()).toBe('26');
  });

  it.each(['.github/workflows/ci.yml', '.github/workflows/pages.yml'])(
    '%s takes the Node version from .nvmrc, never a literal',
    (rel) => {
      const wf = read(rel);
      expect(wf).toContain('cat .nvmrc');
      expect(wf).toContain('node-version: ${{ steps.node.outputs.version }}');
      expect(wf).not.toMatch(/node-version: '\d+'/);
    },
  );

  it.each(['package.json', 'site/package.json'])('%s pins @types/node to ^26', (rel) => {
    expect(JSON.parse(read(rel)).devDependencies['@types/node']).toMatch(/^\^26\./);
  });
});
