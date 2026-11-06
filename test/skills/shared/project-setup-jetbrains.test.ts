import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const SKILL = path.resolve(__dirname, '../../../skills/shared/project-setup');
const SCRIPT = path.join(SKILL, 'scripts/New-EditorConfig.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe('launch-targets reference (jetbrains)', () => {
  it('documents the .run files and the py skip', () => {
    const ref = fs.readFileSync(path.join(SKILL, 'references/launch-targets.md'), 'utf8');
    for (const w of ['.run/', '-Editor jetbrains', 'Rider', 'GoLand']) {
      expect(ref).toContain(w);
    }
  });
});

describe.skipIf(!hasPwsh)('New-EditorConfig.ps1 -Editor jetbrains', () => {
  let dir: string;
  let worker: PwshWorker;
  beforeAll(() => {
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(() => worker.close());
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'jbcfg-')));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (rel: string, content = '') => {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };
  const read = (rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');
  const runFiles = () =>
    fs.existsSync(path.join(dir, '.run')) ? fs.readdirSync(path.join(dir, '.run')).sort() : [];
  const run = async (stack: object, args: string[] = []) => {
    const full = { languages: [], frameworks: [], tools: [], packageManager: [], ...stack };
    const r = await worker.run(
      ['-ProjectRoot', dir, '-Editor', 'jetbrains', '-StackJson', JSON.stringify(full), ...args],
      { cwd: dir },
    );
    return { ...r, json: r.status === 0 ? JSON.parse(r.stdout) : null };
  };

  it('dry run writes nothing and plans the files', async () => {
    const r = await run({ languages: ['go'] });
    expect(r.json.files['Debug_Go.run.xml'].action).toBe('create');
    expect(fs.existsSync(path.join(dir, '.run'))).toBe(false);
  });

  it('ts: shell build and test with pnpm, npm configuration for the dev script', async () => {
    write('package.json', JSON.stringify({ scripts: { dev: 'vite' } }));
    await run({ languages: ['ts'], packageManager: ['pnpm'] }, ['-Apply']);
    expect(runFiles()).toEqual([
      'Debug_dev_server_dev.run.xml',
      'build_ts.run.xml',
      'test_ts.run.xml',
    ]);
    expect(read('.run/build_ts.run.xml')).toContain('value="pnpm run build"');
    expect(read('.run/Debug_dev_server_dev.run.xml')).toContain('<script value="dev" />');
  });

  it('ts without dev or start script: build and test only, with a note', async () => {
    write('package.json', JSON.stringify({ scripts: {} }));
    const r = await run({ languages: ['ts'] }, ['-Apply']);
    expect(runFiles()).toEqual(['build_ts.run.xml', 'test_ts.run.xml']);
    expect(r.json.notes.join(' ')).toContain('no dev or start script');
  });

  it.each([
    ['rust', 'Debug_cargo_run.run.xml', 'CargoCommandRunConfiguration'],
    ['go', 'Debug_Go.run.xml', 'GoApplicationRunConfiguration'],
  ])('%s: start configuration of the IDE type', async (lang, file, type) => {
    await run({ languages: [lang] }, ['-Apply']);
    expect(runFiles()).toContain(file);
    expect(read(`.run/${file}`)).toContain(`type="${type}"`);
  });

  it('dotnet: project path of the executable project', async () => {
    write(
      'src/App/App.csproj',
      '<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType></PropertyGroup></Project>',
    );
    await run({ languages: ['csharp'] }, ['-Apply']);
    expect(read('.run/Debug_dotnet_App.run.xml')).toContain('$PROJECT_DIR$/src/App/App.csproj');
    expect(runFiles()).toContain('build_dotnet.run.xml');
  });

  it('py: test only, with a note that the current file cannot be a target', async () => {
    const r = await run({ languages: ['python'] }, ['-Apply']);
    expect(runFiles()).toEqual(['test_py.run.xml']);
    expect(r.json.notes.join(' ')).toContain('py:');
  });

  it('language without mapping is skipped with a note', async () => {
    const r = await run({ languages: ['java'] }, ['-Apply']);
    expect(runFiles()).toEqual([]);
    expect(r.json.notes.join(' ')).toContain("'java'");
  });

  it('an existing file is never changed', async () => {
    write('.run/build_go.run.xml', 'mine');
    const r = await run({ languages: ['go'] }, ['-Apply']);
    expect(read('.run/build_go.run.xml')).toBe('mine');
    expect(r.json.files['build_go.run.xml'].action).toBe('exists');
    expect(runFiles()).toContain('Debug_Go.run.xml');
  });
});
