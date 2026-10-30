import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const SCRIPT = path.resolve(
  __dirname,
  '../../../skills/shared/implementation/scripts/Format-Changed.ps1',
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

// Format-Changed.ps1 without -Language, -Extensions and -Command: the formatter follows the extensions of the changed files
describe.skipIf(!hasPwsh || process.platform === 'win32')('Format-Changed.ps1 detection', () => {
  let worker: PwshWorker;
  let tmp: string;
  let bin: string;
  const repo = { mixed: '', other: '', cfg: '' };
  const log = () => path.join(tmp, 'calls.log');

  const write = (cwd: string, rel: string, c = 'x') => {
    fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    fs.writeFileSync(path.join(cwd, rel), c);
  };
  const mkRepo = (name: string, files: string[]) => {
    const d = fs.mkdtempSync(path.join(tmp, `${name}-`));
    spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: d });
    for (const f of files) write(d, f);
    return d;
  };
  const go = (cwd: string, args: string[]) =>
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

  beforeAll(() => {
    worker = new PwshWorker(SCRIPT);
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fmtd-')));
    bin = fs.mkdtempSync(path.join(tmp, 'bin-'));
    for (const name of ['npx', 'uv', 'fmt'])
      fs.writeFileSync(
        path.join(bin, name),
        `#!/bin/sh\ncase "$*" in *--version*) exit 0;; esac\n{ printf '%s' ${name}; for a in "$@"; do printf '\\t%s' "$a"; done; echo; } >> "$FAKE_LOG"\n`,
        { mode: 0o755 },
      );
    repo.mixed = mkRepo('mixed', ['a.ts', 'b.py', 'n.md', 'x.txt']);
    repo.other = mkRepo('other', ['n.md', 'x.txt']);
    repo.cfg = mkRepo('cfg', ['a.ts', 'b.py']);
    write(
      repo.cfg,
      '.agents/config.json',
      JSON.stringify({
        format: {
          py: { extensions: ['.py'], format: ['fmt {files}'], check: ['fmt --check {files}'] },
        },
      }),
    );
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  beforeEach(() => fs.rmSync(log(), { force: true }));

  it('runs the defaults of every detected language and ignores other extensions (ts + py)', async () => {
    const r = await go(repo.mixed, []);
    expect(r.status).toBe(0);
    expect(calls()).toEqual([
      'npx --no-install prettier --write a.ts',
      'npx --no-install eslint --fix a.ts',
      'uv run ruff format b.py',
      'uv run ruff check --fix b.py',
    ]);
    expect(r.stdout.trim().split('\n')).toEqual(['formatted: 1 files', 'formatted: 1 files']);
  });

  it('-Check runs the read-only variants', async () => {
    await go(repo.mixed, ['-Check']);
    expect(calls()).toEqual([
      'npx --no-install prettier --check a.ts',
      'npx --no-install eslint a.ts',
      'uv run ruff format --check b.py',
      'uv run ruff check b.py',
    ]);
  });

  it('-WhatIf lists the steps of every detected language and runs nothing', async () => {
    const r = await go(repo.mixed, ['-WhatIf']);
    const steps = JSON.parse(r.stdout);
    expect(steps.map((s: { tool: string }) => s.tool)).toEqual(['prettier', 'eslint', 'ruff']);
    expect(steps[2].commands).toEqual([
      'uv run ruff format {files}',
      'uv run ruff check --fix {files}',
    ]);
    expect(calls()).toEqual([]);
  });

  // the language of a step is the one its tool belongs to (ts: prettier, eslint or biome; py: ruff; ...)
  const toLanguage: Record<string, string> = {
    prettier: 'ts',
    eslint: 'ts',
    biome: 'ts',
    ruff: 'py',
    dotnet: 'dotnet',
    cargo: 'rust',
    gofmt: 'go',
  };
  it.each([
    ['a.ts', 'ts'],
    ['a.tsx', 'ts'],
    ['a.js', 'ts'],
    ['a.jsx', 'ts'],
    ['a.mjs', 'ts'],
    ['a.cjs', 'ts'],
    ['a.json', 'ts'],
    ['a.css', 'ts'],
    ['a.html', 'ts'],
    ['b.py', 'py'],
    ['c.cs', 'dotnet'],
    ['c.csproj', 'dotnet'],
    ['c.sln', 'dotnet'],
    ['c.slnx', 'dotnet'],
    ['d.rs', 'rust'],
    ['e.go', 'go'],
  ])('maps %s to the %s language', async (file, language) => {
    const dir = mkRepo(`ext-${path.extname(file).slice(1)}`, [file]);
    const r = await go(dir, ['-WhatIf']);
    expect(r.status).toBe(0);
    const tools: string[] = JSON.parse(r.stdout).map((s: { tool: string }) => s.tool);
    expect([...new Set(tools.map((t) => toLanguage[t]))]).toEqual([language]);
    expect(calls()).toEqual([]);
  });

  it('-Language ts output is the ts steps only, unchanged by the detection (repo has .py too)', async () => {
    const r = await go(repo.mixed, ['-Language', 'ts', '-WhatIf']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual([
      {
        tool: 'prettier',
        extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
        requires: 'npx --no-install prettier --version',
        commands: ['npx --no-install prettier --write {files}'],
      },
      {
        tool: 'eslint',
        extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs'],
        requires: 'npx --no-install eslint --version',
        commands: ['npx --no-install eslint --fix {files}'],
      },
    ]);
    expect(calls()).toEqual([]);
  });

  it('a format.<Language> config entry replaces the defaults of that language only', async () => {
    await go(repo.cfg, []);
    // the untracked .agents/config.json is itself a changed .json file, so prettier takes it too
    expect(calls()).toEqual([
      'npx --no-install prettier --write .agents/config.json a.ts',
      'npx --no-install eslint --fix a.ts',
      'fmt b.py',
    ]);
  });

  it('unknown extensions only: skipped: no changed files (-WhatIf: empty list)', async () => {
    const r = await go(repo.other, []);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('skipped: no changed files');
    expect(JSON.parse((await go(repo.other, ['-WhatIf'])).stdout)).toEqual([]);
    expect(calls()).toEqual([]);
  });

  it('an explicit -Extensions/-Command call is unchanged and ignores detection', async () => {
    const r = await go(repo.mixed, ['-Extensions', '.py', '-Command', 'fmt {files}']);
    expect(r.status).toBe(0);
    expect(calls()).toEqual(['fmt b.py']);
  });
});
