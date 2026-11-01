import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/shared/detect-techstack/scripts/Detect-TechStack.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

const hint =
  'docs/adr or docs/specs found but no governance key in .agents/config.json; add it to opt in (docs/usage/project-config.md)';
const noDocs = {
  configured: false,
  adrDir: 'docs/adr',
  adrCount: 0,
  specDir: 'docs/specs',
  specCount: 0,
  hint: null,
};

describe.skipIf(!hasPwsh)('Detect-TechStack.ps1', () => {
  let dir: string;
  // one pwsh worker for the describe runs the script in-process per call instead of one pwsh start per case
  let worker: PwshWorker;
  beforeAll(() => {
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(() => worker.close());
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'detect-')));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (rel: string, content = '') => {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };
  const detect = async (env?: NodeJS.ProcessEnv) => {
    const r = await worker.run(['-ProjectRoot', dir], { cwd: dir, env });
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };

  // a git repository and a state dir in the invoking env: the script keeps no state (no cache, no exclude entry)
  it('reports a pure Rust project, ignores a tauri.conf.json outside src-tauri and keeps no state', async () => {
    write('Cargo.toml', '[package]\nname = "x"\n');
    write('docs/tauri.conf.json', '{}');
    spawnSync('git', ['-C', dir, 'init', '-q']);
    const exclude = path.join(dir, '.git', 'info', 'exclude');
    const before = fs.readFileSync(exclude, 'utf8');
    const state = path.join(dir, 'custom-state');
    const r = await detect({ ...process.env, DROMOS_STATE_DIR: state });
    expect(r.languages).toEqual(['rust']);
    expect(r.test).toEqual(['rust-test']);
    expect(r.implementation).toEqual(['rust-implementation']);
    expect(r.packageManager).toEqual(['cargo']);
    expect(r.frameworks).toEqual([]);
    expect(r.governance).toEqual(noDocs);
    expect(r).not.toHaveProperty('state_dir');
    expect(r).not.toHaveProperty('manifest_hash');
    expect(fs.existsSync(state)).toBe(false);
    expect(fs.existsSync(path.join(dir, '.git', 'agents'))).toBe(false);
    expect(fs.readFileSync(exclude, 'utf8')).toBe(before);
  });

  it('reports tools by config file presence in the project root', async () => {
    write('Cargo.toml', '[package]\n');
    write('biome.jsonc', '{}');
    write('eslint.config.mjs');
    write('.prettierrc.json');
    write('jest.config.js');
    write('pytest.ini');
    write('vitest.config.ts');
    expect((await detect()).tools).toEqual([
      'vitest',
      'biome',
      'eslint',
      'prettier',
      'jest',
      'pytest',
      'cargo',
    ]);
  });

  it('reports Tauri next to the TS frontend (Tauri 2, json and json5 once)', async () => {
    write('package.json', '{"packageManager":"pnpm@9.0.0"}');
    write('tsconfig.json', '{}');
    write('src-tauri/Cargo.toml', '[package]\nname = "app"\n');
    write('src-tauri/tauri.conf.json', '{}');
    write('src-tauri/tauri.conf.json5', '{}');
    const r = await detect();
    expect(r.languages).toEqual(['ts', 'rust']);
    expect(r.test).toEqual(['ts-test', 'rust-test']);
    expect(r.implementation).toEqual(['ts-implementation', 'rust-implementation']);
    expect(r.frameworks).toEqual(['tauri']);
    expect(r.packageManager).toEqual(['pnpm', 'cargo']);
  });

  it('detects tauri.conf.json5 with src-tauri but no package.json', async () => {
    write('src-tauri/Cargo.toml', '[package]\n');
    write('src-tauri/tauri.conf.json5', '{}');
    const r = await detect();
    expect(r.languages).toEqual(['rust']);
    expect(r.frameworks).toEqual(['tauri']);
    expect(r.packageManager).toEqual(['cargo']);
  });

  it('reports aspire for an SDK-style AppHost csproj (attribute and element form)', async () => {
    write('src/AppHost/AppHost.csproj', '<Project Sdk="Aspire.AppHost.Sdk/13.6.0"></Project>');
    let r = await detect();
    expect(r.languages).toEqual(['dotnet']);
    expect(r.frameworks).toEqual(['dotnet', 'aspire']);
    fs.rmSync(path.join(dir, 'src'), { recursive: true });
    write(
      'AppHost.csproj',
      '<Project Sdk="Microsoft.NET.Sdk"><Sdk Name="Aspire.AppHost.Sdk" Version="13.6.0" /></Project>',
    );
    r = await detect();
    expect(r.frameworks).toEqual(['dotnet', 'aspire']);
  });

  it('reports aspire for a file-based apphost.cs without any csproj', async () => {
    write(
      'apphost.cs',
      '#:sdk Aspire.AppHost.Sdk@13.6.0\nvar b = DistributedApplication.CreateBuilder(args);\n',
    );
    const r = await detect();
    expect(r.languages).toEqual(['dotnet']);
    expect(r.frameworks).toEqual(['dotnet', 'aspire']);
  });

  it('does not report aspire for a plain .NET project or an ordinary .cs file, hints at ADRs without a governance key', async () => {
    write('App.csproj', '<Project Sdk="Microsoft.NET.Sdk"></Project>');
    write('Program.cs', 'Console.WriteLine("hi");\n');
    for (const f of ['0001-first.md', '0002-second.md', 'README.md']) write(`docs/adr/${f}`);
    const r = await detect();
    expect(r.frameworks).toEqual(['dotnet']);
    // ADRs without the governance key: hint set, README is no ADR
    expect(r.governance).toEqual({ ...noDocs, adrCount: 2, hint });
  });

  it('reports react, next, vue and svelte from dependencies and devDependencies, skills stay ts, vitest via a vite.config test block', async () => {
    write(
      'package.json',
      JSON.stringify({
        dependencies: { next: '^15', react: '^19' },
        devDependencies: { svelte: '^5', vue: '^3' },
      }),
    );
    write('tsconfig.json', '{}');
    write('vite.config.ts', 'export default { test: { globals: true } };');
    const r = await detect();
    expect(r.tools).toEqual(['vitest']);
    expect(r.frameworks).toEqual(['react', 'next', 'vue', 'svelte']);
    expect(r.languages).toEqual(['ts']);
    expect(r.test).toEqual(['ts-test']);
    expect(r.implementation).toEqual(['ts-implementation']);
  });

  it('reports react next to angular in a monorepo, vitest and pytest via devDependencies and pyproject', async () => {
    write('apps/web/package.json', '{"dependencies":{"react":"^19"}}');
    write('apps/ng/angular.json', '{}');
    write('apps/ng/package.json', '{"dependencies":{"@angular/core":"^20"}}');
    write('package.json', '{"devDependencies":{"vitest":"^2"}}');
    write('pyproject.toml', '[tool.pytest.ini_options]\n');
    const r = await detect();
    expect(r.frameworks).toEqual(['react', 'angular']);
    expect(r.tools).toEqual(['vitest', 'pytest']);
  });

  // vendored, build-output and too deep manifests do not make the project Go or Rust
  it('reports js without tsconfig, ignores unrelated or empty dependencies and vendored or too deep manifests', async () => {
    write(
      'package.json',
      '{"dependencies":{"react-dom":"^19","preact":"^10"},"devDependencies":null}',
    );
    for (const d of ['vendor', 'testdata', 'node_modules']) write(`${d}/dep/go.mod`, 'module x\n');
    for (const d of ['target', 'vendor', 'node_modules'])
      write(`${d}/dep/Cargo.toml`, '[package]\n');
    write('a/b/c/d/e/f/go.mod', 'module x\n');
    write('vite.config.ts', 'export default { plugins: [] };');
    const r = await detect();
    expect(r.tools).toEqual([]);
    expect(r.languages).toEqual(['js']);
    expect(r.frameworks).toEqual([]);
  });

  it('reports a Python + Rust + Go monorepo (go.mod at depth 5, custom governance adrDir)', async () => {
    write('crates/core/Cargo.toml', '[package]\n');
    write('py/pyproject.toml', '[project]\nname = "p"\n');
    write('svc/a/b/c/d/go.mod', 'module example.com/x\n\ngo 1.22\n');
    write('.agents/config.json', '{"governance":{"adrDir":"decisions"}}');
    write('decisions/0001-x.md');
    write('decisions/0002-y.md');
    write('docs/adr/0009-ignored.md');
    write('docs/specs/a.md');
    const r = await detect();
    expect(r.governance).toEqual({
      ...noDocs,
      configured: true,
      adrDir: 'decisions',
      adrCount: 2,
      specCount: 1,
    });
    expect(r.languages).toEqual(['py', 'rust', 'go']);
    expect(r.test).toEqual(['py-test', 'rust-test', 'go-test']);
    expect(r.packageManager).toEqual(['cargo', 'go']);
  });

  it('reports governance as not configured for an invalid config.json without failing', async () => {
    write('.agents/config.json', '{"governance": ');
    write('docs/adr/0001-a.md');
    expect((await detect()).governance).toEqual({ ...noDocs, adrCount: 1, hint });
  });
});
