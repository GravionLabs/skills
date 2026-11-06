import Ajv2020 from 'ajv/dist/2020';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const SKILL = path.resolve(__dirname, '../../../skills/shared/project-setup');
const SCRIPT = path.join(SKILL, 'scripts/Set-ProjectSetup.ps1');
const SCHEMA = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../skills/shared/implementation/schema/config.schema.json'),
    'utf8',
  ),
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(SCHEMA);

describe.skipIf(!hasPwsh)('Set-ProjectSetup.ps1', () => {
  let dir: string;
  let worker: PwshWorker;
  beforeAll(() => {
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(() => worker.close());
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'psetup-')));
    stack = null;
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (rel: string, content = '') => {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };
  const read = (rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');
  const exists = (rel: string) => fs.existsSync(path.join(dir, rel));
  // detect-techstack costs ~1 s per run: only the 'real detection' cases run it, the others hand the script a report
  let stack: string | null = null;
  const use = (languages: string[], tools: string[] = [], frameworks: string[] = []) => {
    stack = JSON.stringify({ languages, frameworks, tools });
  };
  const run = async (args: string[] = [], env?: NodeJS.ProcessEnv) => {
    const r = await worker.run(
      ['-ProjectRoot', dir, ...(stack ? ['-StackJson', stack] : []), ...args],
      {
        cwd: dir,
        env,
      },
    );
    return { ...r, json: r.status === 0 ? JSON.parse(r.stdout) : null };
  };
  const lang = (json: any, l: string) => json.languages.find((x: any) => x.language === l);
  const ts = () => use(['ts']);
  // a PATH without any `jb`, or with a fake one
  const pathWithout = () =>
    (process.env.PATH ?? '')
      .split(path.delimiter)
      .filter((d) => !fs.existsSync(path.join(d.replace(/^~/, os.homedir()), 'jb')))
      .join(path.delimiter);
  const withFakeJb = () => {
    const bin = path.join(dir, '.fakebin');
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, 'jb'), '#!/bin/sh\n', { mode: 0o755 });
    return { ...process.env, PATH: bin + path.delimiter + pathWithout() };
  };

  describe('detection mapping', () => {
    it('maps the detected stack of a polyglot project to the keys of format', async () => {
      write('package.json', '{"name":"x"}');
      write('tsconfig.json', '{}');
      write('biome.json', '{}');
      write('pyproject.toml', '[tool.ruff]\nline-length = 100\n');
      write('Cargo.toml');
      write('go.mod');
      write('App.csproj');
      const r = await run();
      expect(r.status).toBe(0);
      expect(r.json.mode).toBe('dry-run');
      const rows = Object.fromEntries(
        r.json.languages.map((l: any) => [l.language, [l.default, l.detected]]),
      );
      expect(rows).toEqual({
        ts: ['biome', 'biome'],
        py: ['ruff', 'ruff'],
        dotnet: ['dotnet-format', expect.toBeOneOf([null, 'jb'])],
        rust: ['cargo-fmt', null],
        go: ['gofmt', null],
      });
      for (const l of r.json.languages) expect(l.options).toContain('custom');
    });

    it('maps angular to ng and defaults to prettier-eslint without biome', async () => {
      write('package.json', '{"name":"x"}');
      write('tsconfig.json', '{}');
      write('angular.json', '{}');
      const r = await run();
      expect(r.json.languages.map((l: any) => l.language)).toEqual(['ng']);
      expect(lang(r.json, 'ng').default).toBe('prettier-eslint');
      expect(lang(r.json, 'ng').options).toEqual(['prettier-eslint', 'biome', 'custom']);
    });

    it('an empty project has no languages', async () => {
      expect((await run()).json.languages).toEqual([]);
    });

    it.each([
      [['js'], ['biome', 'eslint'], 'ts', 'biome', 'biome+eslint'],
      [['ts'], ['prettier'], 'ts', 'prettier-eslint', 'prettier'],
      [['ts'], [], 'ng', 'prettier-eslint', null],
    ])('report %j tools %j gives %s default %s', async (langs, tools, key, def, detected) => {
      use(langs, tools, key === 'ng' ? ['angular'] : []);
      const r = await run();
      expect(r.json.languages).toHaveLength(1);
      expect(lang(r.json, key).default).toBe(def);
      expect(lang(r.json, key).detected).toBe(detected);
    });

    it('lists the JetBrains option for dotnet', async () => {
      use(['dotnet']);
      expect(lang((await run()).json, 'dotnet').options).toEqual(['dotnet-format', 'jb', 'custom']);
    });
  });

  describe('format key', () => {
    it('dry run writes nothing', async () => {
      ts();
      const r = await run(['-Choice', 'ts=biome']);
      expect(lang(r.json, 'ts').write).toBe(true);
      expect(exists('.agents/config.json')).toBe(false);
      expect(exists('.editorconfig')).toBe(false);
    });

    it('default choices write no format key', async () => {
      ts();
      use(['ts', 'rust']);
      const r = await run(['-Apply', '-Choice', 'ts=default', '-Choice', 'rust=cargo-fmt']);
      expect(r.status).toBe(0);
      expect(r.json.format).toBe('unchanged');
      expect(exists('.agents/config.json')).toBe(false);
    });

    it('merges a non-default choice into the existing config and validates against the schema', async () => {
      ts();
      use(['ts', 'dotnet']);
      write('App.sln');
      write(
        '.agents/config.json',
        JSON.stringify({
          governance: { adrDir: 'docs/adr' },
          format: { py: { format: 'black {files}' } },
        }),
      );
      const r = await run(['-Apply', '-Choice', 'ts=biome'], withFakeJb());
      expect(r.status).toBe(0);
      const cfg = JSON.parse(read('.agents/config.json'));
      expect(cfg.governance).toEqual({ adrDir: 'docs/adr' });
      expect(cfg.format.py).toEqual({ format: 'black {files}' });
      expect(cfg.format.ts.format).toBe('npx biome check --write --no-errors-on-unmatched {files}');
      expect(cfg.format.dotnet).toBeUndefined();
      expect(validate(cfg), JSON.stringify(validate.errors)).toBe(true);
    });

    it('writes jb for dotnet with the solution and the dotnet format check, and validates', async () => {
      write('App.csproj');
      use(['dotnet']);
      write('App.sln');
      const r = await run(['-Apply', '-Choice', 'dotnet=jb'], withFakeJb());
      const cfg = JSON.parse(read('.agents/config.json'));
      expect(cfg.format.dotnet).toEqual({
        extensions: ['.cs'],
        format: 'jb cleanupcode --include={files} App.sln',
        check: 'dotnet format --verify-no-changes --include {files}',
      });
      expect(validate(cfg), JSON.stringify(validate.errors)).toBe(true);
      expect(cfg.$schema).toContain('config.schema.json');
      expect(r.json.warnings).toEqual([]);
    });

    it('reports a missing jb with its install hint and still installs nothing', async () => {
      write('App.csproj');
      use(['dotnet']);
      write('App.sln');
      const env = { ...process.env, PATH: pathWithout() };
      const r = await run(['-Choice', 'dotnet=jb'], env);
      expect(lang(r.json, 'dotnet').tools[0]).toMatchObject({ name: 'jb', found: false });
      expect(r.json.warnings).toEqual([
        'jb not found: dotnet tool install -g JetBrains.ReSharper.GlobalTools',
      ]);
      // not chosen: no warning
      expect((await run([], env)).json.warnings).toEqual([]);
    });

    it('custom takes both commands and validates', async () => {
      write('pyproject.toml');
      use(['py']);
      const r = await run([
        '-Apply',
        '-Choice',
        'py=custom',
        '-FormatCommand',
        'py=black {files}',
        '-CheckCommand',
        'py=black --check {files}',
      ]);
      expect(r.status).toBe(0);
      const cfg = JSON.parse(read('.agents/config.json'));
      expect(cfg.format.py).toEqual({
        extensions: ['.py', '.pyi'],
        format: 'black {files}',
        check: 'black --check {files}',
      });
      expect(validate(cfg), JSON.stringify(validate.errors)).toBe(true);
    });

    it('leaves a disabled format (false) alone', async () => {
      ts();
      write('.agents/config.json', '{"format":false}');
      const r = await run(['-Apply', '-Choice', 'ts=biome']);
      expect(r.json.format).toMatch(/^skipped: format is false/);
      expect(read('.agents/config.json')).toBe('{"format":false}');
    });

    it.each([
      ['unknown option', ['-Choice', 'ts=nope'], /unknown option 'nope' for ts/],
      ['language not detected', ['-Choice', 'go=default'], /not a detected language/],
      ['custom without commands', ['-Choice', 'ts=custom'], /needs -FormatCommand/],
      ['malformed choice', ['-Choice', 'ts'], /not <lang>=<value>/],
    ])('fails on %s', async (_n, args, msg) => {
      ts();
      const r = await run(args);
      expect(r.status).toBe(1);
      expect(r.stderr).toMatch(msg);
    });

    it('fails on invalid JSON in the config and on jb without a solution', async () => {
      ts();
      write('.agents/config.json', '{ nope');
      const bad = await run(['-Apply', '-Choice', 'ts=biome']);
      expect(bad.status).toBe(1);
      expect(bad.stderr).toMatch(/not valid JSON/);
      write('App.csproj');
      use(['dotnet']);
      fs.rmSync(path.join(dir, '.agents'), { recursive: true });
      const jb = await run(['-Choice', 'dotnet=jb']);
      expect(jb.status).toBe(1);
      expect(jb.stderr).toMatch(/needs a solution file/);
    });
  });

  describe('.editorconfig', () => {
    it('creates the dotnet template plus the sections of the other languages on -Apply only', async () => {
      write('App.csproj');
      use(['dotnet', 'ts', 'rust']);

      const dry = await run();
      expect(dry.json.editorconfig.action).toBe('create');
      expect(exists('.editorconfig')).toBe(false);
      const r = await run(['-Apply']);
      expect(r.json.editorconfig.result).toBe('written');
      const text = read('.editorconfig');
      expect(text).toContain('csharp_style_namespace_declarations');
      expect(text).toContain('[*.{ts,tsx,js,jsx,mjs,cjs,json,jsonc,html,css,scss,md,yml,yaml}]');
      expect(text).toContain('[*.rs]');
      expect(text).not.toContain('[*.go]');
      expect(text).not.toContain('\r');
    });

    it('uses the base for a project without dotnet', async () => {
      write('go.mod');
      use(['go', 'py']);

      await run(['-Apply']);
      const text = read('.editorconfig');
      expect(text).toMatch(/^root = true$/m);
      expect(text).toContain('[*.go]');
      expect(text).toContain('[*.{py,pyi}]');
      expect(text).not.toContain('csharp_');
    });

    it('never overwrites an existing file and shows a diff instead', async () => {
      write('go.mod');
      use(['go']);
      write('.editorconfig', 'root = true\n[*]\nindent_size = 8\n');
      const dry = await run();
      expect(dry.json.editorconfig.action).toBe('exists');
      expect(dry.json.editorconfig.diff).toContain('indent_size = 8');
      const r = await run(['-Apply']);
      expect(r.json.editorconfig.result).toBe('exists');
      expect(read('.editorconfig')).toBe('root = true\n[*]\nindent_size = 8\n');
    });

    it('reports an identical file as unchanged', async () => {
      write('go.mod');
      use(['go']);
      await run(['-Apply']);
      const r = await run(['-Apply']);
      expect(r.json.editorconfig.action).toBe('unchanged');
    });
  });
});

describe('project-setup skill files', () => {
  it('keeps the dotnet template with the skill and out of dotnet-create-solution', () => {
    expect(fs.existsSync(path.join(SKILL, 'templates/dotnet.editorconfig'))).toBe(true);
    expect(
      fs.existsSync(
        path.resolve(
          __dirname,
          '../../../skills/dotnet/dotnet-create-solution/templates/.editorconfig',
        ),
      ),
    ).toBe(false);
  });
  it('SKILL.md has at most 100 lines', () => {
    expect(
      fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8').split('\n').length,
    ).toBeLessThanOrEqual(101);
  });
});
