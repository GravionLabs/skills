import Ajv2020 from 'ajv/dist/2020';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const IMPL = path.resolve(__dirname, '../../../skills/shared/implementation');
const SCRIPT = path.join(IMPL, 'scripts/Invoke-Tests.ps1');
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
  JSON.parse(fs.readFileSync(path.join(IMPL, 'schema/config.schema.json'), 'utf8')),
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

// #507: the `test` key of .agents/config.json
describe('config schema: test', () => {
  it.each([
    { test: false },
    { test: { ts: { command: 'npx vitest run' } } },
    {
      test: {
        py: {
          command: ['uv run pytest -x', 'uv run pytest --doctest-modules'],
          targeted: 'uv run pytest {files}',
        },
      },
    },
  ])('accepts %j', (cfg) => {
    expect(validate(cfg)).toBe(true);
  });

  it.each([
    { test: true },
    { test: { ts: {} } },
    { test: { ts: { command: '' } } },
    { test: { ts: { command: 'x', other: 1 } } },
    { test: { ts: { command: 'x', targeted: ['a'] } } },
  ])('rejects %j', (cfg) => {
    expect(validate(cfg)).toBe(false);
  });
});

describe.skipIf(!hasPwsh || process.platform === 'win32')('Invoke-Tests.ps1', () => {
  let worker: PwshWorker;
  let tmp: string;
  let bin: string;
  let repoN = 0;
  const log = () => path.join(tmp, 'calls.log');
  const write = (cwd: string, rel: string, c = 'x') => {
    fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    fs.writeFileSync(path.join(cwd, rel), c);
  };
  const mkRepo = (files: Record<string, string>) => {
    const d = path.join(tmp, `r${++repoN}`);
    fs.mkdirSync(d);
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: d });
    for (const [f, c] of Object.entries(files)) write(d, f, c);
    return d;
  };
  const cfg = (o: unknown) => ({ '.agents/config.json': JSON.stringify(o) });

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'tests-')));
    worker = new PwshWorker(SCRIPT);
    bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    // fake tools log their argv; `bad` always fails with 5
    for (const name of ['npx', 'npm', 'uv', 'cargo', 'dotnet', 'go', 'one', 'two', 'bad'])
      fs.writeFileSync(
        path.join(bin, name),
        `#!/bin/sh\n{ printf '%s' ${name}; for a in "$@"; do printf '\\t%s' "$a"; done; echo; } >> "$FAKE_LOG"\n` +
          (name === 'bad' ? 'exit 5\n' : ''),
        { mode: 0o755 },
      );
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  beforeEach(() => fs.rmSync(log(), { force: true }));

  const go = (cwd: string, args: string[] = []) =>
    worker.run(args, {
      cwd,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_LOG: log() },
    });
  const calls = () =>
    fs.existsSync(log())
      ? fs
          .readFileSync(log(), 'utf8')
          .trimEnd()
          .split('\n')
          .map((l) => l.split('\t').join(' '))
      : [];
  const plan = async (cwd: string, args: string[] = []) => {
    const r = await go(cwd, ['-WhatIf', ...args]);
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout);
  };

  it('the configured command wins over package.json scripts.test and the detected tool', async () => {
    const d = mkRepo({
      'package.json': JSON.stringify({
        scripts: { test: 'vitest run' },
        devDependencies: { vitest: '1' },
      }),
      ...cfg({ test: { ts: { command: 'one --all' } } }),
    });
    expect(await plan(d, ['-Language', 'ts'])).toEqual([
      { language: 'ts', source: 'config', commands: ['one --all'] },
    ]);
    const r = await go(d, ['-Language', 'ts']);
    expect(r.status).toBe(0);
    expect(calls()).toEqual(['one --all']);
  });

  it('an array runs in order and the first non-zero exit stops the run with that code', async () => {
    const d = mkRepo(cfg({ test: { py: { command: ['one a', 'bad b', 'two c'] } } }));
    const r = await go(d, ['-Language', 'py']);
    expect(r.status).toBe(5);
    expect(calls()).toEqual(['one a', 'bad b']);
  });

  it('-Targeted runs the targeted command with the files; without one it runs the full command', async () => {
    const d = mkRepo(
      cfg({
        test: {
          ts: { command: 'one all', targeted: 'two run {files}' },
          py: { command: 'one pyall' },
        },
      }),
    );
    expect(
      (await go(d, ['-Language', 'ts', '-Targeted', '-Files', 'a.test.ts,b.test.ts'])).status,
    ).toBe(0);
    expect((await go(d, ['-Language', 'py', '-Targeted', '-Files', 'test_a.py'])).status).toBe(0);
    expect(calls()).toEqual(['two run a.test.ts b.test.ts', 'one pyall']);
  });

  it('without the key: package.json scripts.test, then the default of the detected tool', async () => {
    const withScript = mkRepo({
      'package.json': JSON.stringify({ scripts: { test: 'vitest run' } }),
    });
    expect(await plan(withScript, ['-Language', 'ts'])).toEqual([
      { language: 'ts', source: 'package.json', commands: ['npm test'] },
    ]);
    const vitest = mkRepo({
      'package.json': JSON.stringify({ devDependencies: { vitest: '^4' } }),
    });
    expect(await plan(vitest, ['-Language', 'ts'])).toEqual([
      { language: 'ts', source: 'default', commands: ['npx vitest run'] },
    ]);
    const jest = mkRepo({ 'package.json': JSON.stringify({ devDependencies: { jest: '^30' } }) });
    expect(await plan(jest, ['-Language', 'ts'])).toEqual([
      { language: 'ts', source: 'default', commands: ['npx jest'] },
    ]);
  });

  it('a vitest project is never run with jest (the guess of 2026-11-09)', async () => {
    const d = mkRepo({
      'package.json': JSON.stringify({
        scripts: { test: 'vitest run' },
        devDependencies: { vitest: '^4' },
      }),
      'vitest.config.ts': 'export default {}',
    });
    const p = await plan(d);
    expect(JSON.stringify(p)).not.toContain('jest');
  });

  it('targeted default of the tool', async () => {
    const d = mkRepo({ 'package.json': JSON.stringify({ devDependencies: { vitest: '^4' } }) });
    expect(await plan(d, ['-Language', 'ts', '-Targeted', '-Files', 'a.test.ts'])).toEqual([
      { language: 'ts', source: 'default', commands: ['npx vitest run a.test.ts'] },
    ]);
  });

  it.each([
    ['py', { 'pyproject.toml': '[tool.pytest.ini_options]\n' }, 'uv run pytest'],
    ['rust', { 'Cargo.toml': '[package]\n' }, 'cargo test'],
    ['go', { 'go.mod': 'module x\n' }, 'go test ./...'],
    ['dotnet', { 'App.csproj': '<Project/>' }, 'dotnet test'],
  ])('default %s', async (lang, files, cmd) => {
    const d = mkRepo(files);
    expect(await plan(d, ['-Language', lang])).toEqual([
      { language: lang, source: 'default', commands: [cmd] },
    ]);
  });

  it('without -Language each detected language runs', async () => {
    const d = mkRepo({
      'package.json': JSON.stringify({ devDependencies: { vitest: '1' } }),
      'Cargo.toml': '[package]\n',
    });
    const r = await go(d);
    expect(r.status).toBe(0);
    expect(calls()).toEqual(['npx vitest run', 'cargo test']);
  });

  it('"test": false disables every run', async () => {
    const d = mkRepo({ 'Cargo.toml': '[package]\n', ...cfg({ test: false }) });
    const r = await go(d, ['-Language', 'rust']);
    expect(r).toMatchObject({ status: 0, stdout: 'skipped: disabled\n' });
    expect(calls()).toEqual([]);
  });

  it('a bad config fails loudly: unknown key, wrong shape, entry without command', async () => {
    const unknown = mkRepo(cfg({ tset: {} }));
    expect((await go(unknown, ['-Language', 'ts'])).status).toBe(1);
    const shape = mkRepo(cfg({ test: true }));
    const r1 = await go(shape, ['-Language', 'ts']);
    expect(r1.status).toBe(1);
    expect(r1.stderr).toContain("key 'test'");
    const empty = mkRepo(cfg({ test: { ts: { targeted: 'x {files}' } } }));
    const r2 = await go(empty, ['-Language', 'ts']);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain("no 'command'");
  });

  it('nothing configured and nothing detected: a clear skip, no guess', async () => {
    const d = mkRepo({ 'README.md': 'x' });
    const r = await go(d);
    expect(r).toMatchObject({
      status: 0,
      stdout: 'skipped: no test command (no language detected)\n',
    });
    const ts = mkRepo({ 'package.json': '{}' });
    const r2 = await go(ts, ['-Language', 'ts']);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain('no test command');
  });
});
