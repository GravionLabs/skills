import * as fs from 'fs';
import * as path from 'path';

const ts = path.resolve(__dirname, '../../../skills/ts');
const read = (rel: string) => fs.readFileSync(path.join(ts, rel), 'utf-8');

describe('Node version of the ts templates (#72)', () => {
  it.each([
    'ts-create-project/templates/package.json',
    'ts-mcp-server-generator/templates/package.json',
  ])('%s pins @types/node to ^26', (rel) => {
    const pkg = JSON.parse(read(rel));
    expect(pkg.devDependencies['@types/node']).toMatch(/^\^26\./);
  });

  it('the CI template runs on Node 26', () => {
    expect(read('ts-create-project/templates/.github/workflows/ci.yml')).toMatch(
      /node-version: '26'/,
    );
  });

  it('ts-create-project names Node.js 26 and no other Node version', () => {
    const skill = read('ts-create-project/SKILL.md');
    expect(skill).toContain('Node.js 26 LTS');
    expect(skill.match(/Node(?:\.js)? \d+/g)).toEqual(['Node.js 26']);
  });
});
