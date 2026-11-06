import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const SKILL = path.resolve(__dirname, '../../../skills/shared/project-setup');
const SCRIPT = path.join(SKILL, 'scripts/New-EditorConfig.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

type Labeled = { label: string; adapter?: string; command?: string };

describe('launch-targets reference (zed)', () => {
  it('documents the Zed files and the dotnet skip', () => {
    const ref = fs.readFileSync(path.join(SKILL, 'references/launch-targets.md'), 'utf8');
    for (const w of ['.zed/', 'debug.json', 'Delve', 'CodeLLDB', 'Debugpy']) {
      expect(ref).toContain(w);
    }
  });
});

describe.skipIf(!hasPwsh)('New-EditorConfig.ps1 -Editor zed', () => {
  let dir: string;
  let worker: PwshWorker;
  beforeAll(() => {
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(() => worker.close());
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'zedcfg-')));
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
    const r = await worker.run(
      ['-ProjectRoot', dir, '-Editor', 'zed', '-StackJson', JSON.stringify(full), ...args],
      { cwd: dir },
    );
    return { ...r, json: r.status === 0 ? JSON.parse(r.stdout) : null };
  };
  const labels = (rel: string) => readJson(rel).map((x: Labeled) => x.label);

  it('dry run writes nothing', async () => {
    const r = await run({ languages: ['go'] });
    expect(r.json.files['debug.json'].action).toBe('create');
    expect(fs.existsSync(path.join(dir, '.zed'))).toBe(false);
  });

  it('ts with biome and vitest: formatter, pnpm tasks, dev server and vitest debug', async () => {
    write('package.json', JSON.stringify({ scripts: { dev: 'vite' } }));
    await run({ languages: ['ts'], tools: ['biome', 'vitest'], packageManager: ['pnpm'] }, [
      '-Apply',
    ]);
    const s = readJson('.zed/settings.json');
    expect(s.format_on_save).toBe('on');
    expect(s.languages.TypeScript.formatter).toEqual({ language_server: { name: 'biome' } });
    const tasks = readJson('.zed/tasks.json');
    expect(tasks.map((t: Labeled) => t.label)).toEqual(['build: ts', 'test: ts']);
    expect(tasks[0].command).toBe('pnpm run build');
    expect(labels('.zed/debug.json')).toEqual(['Debug dev server (dev)', 'Debug Vitest']);
  });

  it('ng defaults to prettier and uses the start script', async () => {
    write('package.json', JSON.stringify({ scripts: { start: 'ng serve' } }));
    await run({ languages: ['ts'], frameworks: ['angular'] }, ['-Apply']);
    expect(readJson('.zed/settings.json').languages.HTML.formatter).toBe('prettier');
    expect(labels('.zed/debug.json')).toEqual(['Debug dev server (start)']);
  });

  it.each([
    ['py', 'Python', 'Debugpy', 'Debug current Python file'],
    ['rust', 'Rust', 'CodeLLDB', 'Debug cargo run'],
    ['go', 'Go', 'Delve', 'Debug Go'],
  ])('%s: language formatter, adapter and debug entry', async (lang, zedLang, adapter, label) => {
    await run({ languages: [lang === 'py' ? 'python' : lang] }, ['-Apply']);
    expect(
      readJson('.zed/settings.json').languages[zedLang].formatter.language_server,
    ).toBeTruthy();
    const debug = readJson('.zed/debug.json');
    expect(debug.map((d: Labeled) => d.label)).toEqual([label]);
    expect(debug[0].adapter).toBe(adapter);
  });

  it('dotnet gets tasks and a formatter but no debug file, with a note', async () => {
    write('App/App.csproj', '<Project Sdk="Microsoft.NET.Sdk.Web"></Project>');
    const r = await run({ languages: ['dotnet'] }, ['-Apply']);
    expect(labels('.zed/tasks.json')).toEqual(['build: dotnet', 'test: dotnet']);
    expect(fs.existsSync(path.join(dir, '.zed/debug.json'))).toBe(false);
    expect(r.json.notes.join(' ')).toContain('Zed has no built-in .NET debug adapter');
  });

  it('skips undetected frameworks and languages with a note', async () => {
    const r = await run({ languages: ['go', 'java'], frameworks: ['tauri'] });
    const notes = r.json.notes.join(' ');
    expect(notes).toContain("language 'java'");
    expect(notes).toContain("framework 'tauri'");
  });

  it('never changes an existing file and lists what it lacks', async () => {
    const own = '// mine\n{ "format_on_save": "off", }\n';
    write('.zed/settings.json', own);
    write('.zed/tasks.json', JSON.stringify([{ label: 'build: go', command: 'x' }]));
    const r = await run({ languages: ['go'] }, ['-Apply']);
    expect(fs.readFileSync(path.join(dir, '.zed/settings.json'), 'utf8')).toBe(own);
    expect(r.json.files['settings.json'].action).toBe('exists');
    expect(r.json.files['tasks.json'].missing).toEqual(['test: go']);
    expect(readJson('.zed/tasks.json')).toHaveLength(1);
    expect(r.json.files['debug.json'].result).toBe('created');
  });
});
