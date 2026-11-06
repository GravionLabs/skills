import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const SKILL = path.resolve(__dirname, '../../../skills/shared/project-setup');
const SCRIPT = path.join(SKILL, 'scripts/New-EditorConfig.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe('launch-targets reference', () => {
  it('names every mapped language, the debugger types and the skipped frameworks', () => {
    const ref = fs.readFileSync(path.join(SKILL, 'references/launch-targets.md'), 'utf8');
    for (const w of [
      'dotnet',
      'Aspire',
      'ng',
      'Vitest',
      'debugpy',
      'lldb',
      'delve',
      'tauri',
      'Skipped',
    ]) {
      expect(ref).toContain(w);
    }
  });
});

describe.skipIf(!hasPwsh)('New-EditorConfig.ps1', () => {
  let dir: string;
  let worker: PwshWorker;
  beforeAll(() => {
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(() => worker.close());
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'editorcfg-')));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (rel: string, content = '') => {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };
  const readJson = (rel: string) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
  const run = async (stack: object, args: string[] = []) => {
    const full = { languages: [], frameworks: [], tools: [], packageManager: [], ...stack };
    const r = await worker.run(['-ProjectRoot', dir, '-StackJson', JSON.stringify(full), ...args], {
      cwd: dir,
    });
    return { ...r, json: r.status === 0 ? JSON.parse(r.stdout) : null };
  };

  it('dry run writes nothing', async () => {
    const r = await run({ languages: ['go'] });
    expect(r.json.files['settings.json'].action).toBe('create');
    expect(fs.existsSync(path.join(dir, '.vscode'))).toBe(false);
  });

  it('rejects an unknown editor', async () => {
    const r = await run({ languages: ['go'] }, ['-Editor', 'emacs']);
    expect(r.status).toBe(1);
  });

  it('writes ts with biome and vitest: dev server, vitest debug, pnpm tasks', async () => {
    write('package.json', JSON.stringify({ scripts: { dev: 'vite' } }));
    await run({ languages: ['ts'], tools: ['biome', 'vitest'], packageManager: ['pnpm'] }, [
      '-Apply',
    ]);
    const settings = readJson('.vscode/settings.json');
    expect(settings['editor.formatOnSave']).toBe(true);
    expect(settings['[typescript]']['editor.defaultFormatter']).toBe('biomejs.biome');
    expect(readJson('.vscode/extensions.json').recommendations).toEqual(
      expect.arrayContaining(['biomejs.biome', 'vitest.explorer']),
    );
    const tasks = readJson('.vscode/tasks.json').tasks;
    expect(tasks.map((t: { label: string }) => t.label)).toEqual(['build: ts', 'test: ts']);
    expect(tasks[0].command).toBe('pnpm run build');
    const names = readJson('.vscode/launch.json').configurations.map(
      (c: { name: string }) => c.name,
    );
    expect(names).toEqual(['Debug dev server (dev)', 'Debug Vitest']);
  });

  it('ng defaults to prettier and eslint', async () => {
    write('package.json', JSON.stringify({ scripts: { start: 'ng serve' } }));
    await run({ languages: ['ts'], frameworks: ['angular'] }, ['-Apply']);
    expect(readJson('.vscode/settings.json')['[typescript]']['editor.defaultFormatter']).toBe(
      'esbenp.prettier-vscode',
    );
    expect(readJson('.vscode/extensions.json').recommendations).toEqual(
      expect.arrayContaining(['angular.ng-template', 'dbaeumer.vscode-eslint']),
    );
    expect(readJson('.vscode/launch.json').configurations[0].runtimeArgs).toEqual(['run', 'start']);
  });

  it.each([
    ['py', 'debugpy', 'charliermarsh.ruff', ['test: py']],
    ['rust', 'lldb', 'rust-lang.rust-analyzer', ['build: rust', 'test: rust']],
    ['go', 'go', 'golang.go', ['build: go', 'test: go']],
  ])('%s: debugger %s, formatter %s', async (lang, type, formatter, labels) => {
    await run({ languages: [lang] }, ['-Apply']);
    expect(readJson('.vscode/launch.json').configurations[0].type).toBe(type);
    expect(readJson('.vscode/extensions.json').recommendations).toContain(formatter);
    expect(readJson('.vscode/tasks.json').tasks.map((t: { label: string }) => t.label)).toEqual(
      labels,
    );
  });

  it('dotnet debugs the executable project, Aspire the AppHost', async () => {
    write('src/Api/Api.csproj', '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');
    write('src/AppHost/AppHost.csproj', '<Project Sdk="Aspire.AppHost.Sdk/9.0.0"></Project>');
    const plain = await run({ languages: ['dotnet'] });
    expect(plain.json.files['launch.json'].content.configurations[0].projectPath).toBe(
      '${workspaceFolder}/src/Api/Api.csproj',
    );
    const aspire = await run({ languages: ['dotnet'], frameworks: ['aspire'] });
    const cfg = aspire.json.files['launch.json'].content.configurations[0];
    expect(cfg.name).toContain('Aspire AppHost');
    expect(cfg.projectPath).toBe('${workspaceFolder}/src/AppHost/AppHost.csproj');
    expect(aspire.json.files['settings.json'].content['[csharp]']['editor.defaultFormatter']).toBe(
      'ms-dotnettools.csdevkit',
    );
  });

  it('skips undetected languages and frameworks without a target with a note', async () => {
    const r = await run({ languages: ['go', 'java'], frameworks: ['tauri'] });
    expect(r.json.languages).toEqual(['go']);
    expect(r.json.notes.join('\n')).toMatch(/java.*skipped/);
    expect(r.json.notes.join('\n')).toMatch(/tauri/);
    const none = await run({ languages: ['java'] }, ['-Apply']);
    expect(none.json.files['tasks.json'].action).toBe('skip');
    expect(fs.existsSync(path.join(dir, '.vscode'))).toBe(false);
  });

  it('never touches an existing file and lists what is missing', async () => {
    const own = '{\n  // mine\n  "editor.formatOnSave": false,\n}\n';
    write('.vscode/settings.json', own);
    write(
      '.vscode/tasks.json',
      JSON.stringify({ version: '2.0.0', tasks: [{ label: 'build: go' }] }),
    );
    const r = await run({ languages: ['go'] }, ['-Apply']);
    expect(fs.readFileSync(path.join(dir, '.vscode/settings.json'), 'utf8')).toBe(own);
    expect(r.json.files['settings.json']).toMatchObject({
      action: 'exists',
      missing: ['[go]'],
      result: 'unchanged',
    });
    expect(r.json.files['tasks.json'].missing).toEqual(['test: go']);
    expect(readJson('.vscode/tasks.json').tasks).toHaveLength(1);
    expect(r.json.files['launch.json'].result).toBe('created');
  });
});
