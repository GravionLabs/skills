import * as fs from 'fs';
import * as path from 'path';

const packages = path.resolve(__dirname, '../../../skills');
const read = (rel: string) => fs.readFileSync(path.join(packages, rel), 'utf-8');
const description = (rel: string) => {
  const fm = /^---\n([\s\S]*?)\n---/.exec(read(rel))![1];
  return /^description: (.*)$/m.exec(fm)![1];
};

describe('ts skill facts (#772)', () => {
  it('ts-implementation: .js import extension only for NodeNext/Node16', () => {
    const t = read('ts/ts-implementation/SKILL.md');
    expect(t).toMatch(/`\.js` extension[^\n]*only when `moduleResolution` is `NodeNext`\/`Node16`/);
    expect(t).toContain('`bundler`');
  });

  it('ts-mcp-server-generator: Inspector supports stdio, SSE and Streamable HTTP', () => {
    const t = read('ts/ts-mcp-server-generator/SKILL.md');
    expect(t).not.toMatch(/Inspector works only with stdio/);
    expect(t).toMatch(/Inspector connects to stdio, SSE and Streamable HTTP/);
  });

  it('ts-mcp-server-generator: the never-throw rule is written once', () => {
    const t = read('ts/ts-mcp-server-generator/SKILL.md');
    expect(t.match(/isError: true/g)).toHaveLength(1);
  });

  it('the tsconfig template lists node types (TypeScript 6 loads none by default)', () => {
    const cfg = JSON.parse(read('ts/ts-mcp-server-generator/templates/tsconfig.json'));
    expect(cfg.compilerOptions.types).toEqual(['node']);
  });
});

describe('dotnet-mcp-server-generator facts (#772)', () => {
  const skill = read('dotnet/dotnet-mcp-server-generator/SKILL.md');
  const templates = ['Program.cs', 'Tools.cs', 'Prompts.cs']
    .map((f) => read(`dotnet/dotnet-mcp-server-generator/templates/${f}`))
    .join('\n');

  it('uses the stable package and CallToolResult', () => {
    expect(skill).not.toContain('--prerelease');
    expect(skill).not.toMatch(/prerelease/i);
    expect(skill).toContain('dotnet add package ModelContextProtocol\n');
    expect(skill).toContain('CallToolResult');
    expect(skill).not.toContain('CallToolResponse');
  });

  it('templates use the current content type names', () => {
    expect(templates).toContain('new TextContentBlock');
    expect(templates).not.toMatch(/new TextContent\b(?!Block)/);
    expect(templates).not.toContain('CallToolResponse');
  });
});

describe('descriptions carry a "Use" trigger (#772)', () => {
  it.each([
    'rust/rust-implementation',
    'py/py-create-project',
    'ts/ts-create-project',
    'dotnet/dotnet-mcp-server-generator',
    'ts/ts-mcp-server-generator',
  ])('%s', (dir) => {
    expect(description(`${dir}/SKILL.md`)).toMatch(/\bUse\b/);
  });
});
