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

// the `-Lint` mode of Format-Changed.ps1: configured, default, disabled and failing commands, on fake tools
describe.skipIf(!hasPwsh || process.platform === 'win32')('Format-Changed.ps1 -Lint', () => {
  let worker: PwshWorker;
  let tmp: string;
  const bins = { ok: '', noProbe: '', gitOnly: '' };
  const repo = { langs: '', cfg: '' };
  const log = () => path.join(tmp, 'calls.log');
  const git = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd });
  const write = (cwd: string, rel: string, c = 'x') => {
    fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    fs.writeFileSync(path.join(cwd, rel), c);
  };
  const mkRepo = (name: string, files: string[]) => {
    const d = fs.mkdtempSync(path.join(tmp, `${name}-`));
    git(d, 'init', '-q', '-b', 'main');
    for (const f of files) write(d, f);
    return d;
  };

  beforeAll(() => {
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'lint-')));
    worker = new PwshWorker(SCRIPT);
    // fake tools log their argv; a `--version` probe exits `probe`; `bad` always fails with 5
    const names = ['npx', 'uv', 'dotnet', 'cargo', 'golangci-lint', 'jb', 'one', 'two', 'bad'];
    for (const [k, probe] of [
      ['ok', 0],
      ['noProbe', 1],
    ] as const) {
      bins[k] = fs.mkdtempSync(path.join(tmp, `bin-${k}-`));
      for (const name of names)
        fs.writeFileSync(
          path.join(bins[k], name),
          `#!/bin/sh\ncase "$*" in *--version*) exit ${probe};; esac\n` +
            `{ printf '%s' ${name}; for a in "$@"; do printf '\\t%s' "$a"; done; echo; } >> "$FAKE_LOG"\n` +
            (name === 'bad' ? 'echo broken >&2; exit 5\n' : ''),
          { mode: 0o755 },
        );
    }
    bins.gitOnly = fs.mkdtempSync(path.join(tmp, 'bin-git-'));
    const gitPath = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    fs.symlinkSync(gitPath, path.join(bins.gitOnly, 'git'));
    repo.langs = mkRepo('langs', ['a.ts', 'e.py', 'F.cs', 'src/lib.rs', 'cmd/main.go', 'n.md']);
    repo.cfg = mkRepo('cfg', ['a.ts', 'A.cs', 'B.cs']);
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  beforeEach(() => {
    fs.rmSync(log(), { force: true });
    fs.rmSync(path.join(repo.cfg, '.agents'), { recursive: true, force: true });
  });

  const go = (cwd: string, args: string[], bin = bins.ok) =>
    worker.run(args, {
      cwd,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_LOG: log() },
    });
  const callLines = () =>
    fs.existsSync(log())
      ? fs
          .readFileSync(log(), 'utf8')
          .trimEnd()
          .split('\n')
          .map((l) => l.split('\t').join(' '))
      : [];
  const lint = (o: unknown) => write(repo.cfg, '.agents/config.json', JSON.stringify({ lint: o }));

  it.each([
    ['ts', 'npx --no-install eslint a.ts'],
    ['py', 'uv run ruff check e.py'],
    ['dotnet', 'dotnet format analyzers --verify-no-changes --include F.cs'],
    // clippy lints the whole crate: no file is appended
    ['rust', 'cargo clippy --all-targets -- -D warnings'],
    ['go', 'golangci-lint run cmd/main.go'],
  ])('default %s runs its lint command read-only', async (lang, cmd) => {
    const r = await go(repo.langs, ['-Lint', '-Language', lang]);
    expect(r).toMatchObject({ status: 0, stdout: 'linted: 1 files\n' });
    expect(callLines()).toEqual([cmd]);
  });

  it('without -Language each language of the changed files runs its default', async () => {
    const r = await go(repo.langs, ['-Lint']);
    expect(r.status).toBe(0);
    expect(callLines()).toEqual([
      'npx --no-install eslint a.ts',
      'uv run ruff check e.py',
      'dotnet format analyzers --verify-no-changes --include F.cs',
      'cargo clippy --all-targets -- -D warnings',
      'golangci-lint run cmd/main.go',
    ]);
  });

  it('a configured entry replaces the default; the commands run in order on the same files', async () => {
    lint({ dotnet: { command: ['one {files}', 'two --include={files}'] } });
    const r = await go(repo.cfg, ['-Lint', '-Language', 'dotnet']);
    expect(r).toMatchObject({ status: 0, stdout: 'linted: 2 files\n' });
    // no `extensions` in the entry: those of the built-in default (.cs) apply
    expect(callLines()).toEqual(['one A.cs B.cs', 'two --include=A.cs;B.cs']);
  });

  it('a configured command without {files} runs as it is', async () => {
    lint({ ts: { extensions: ['.ts'], command: 'one --all' } });
    await go(repo.cfg, ['-Lint', '-Language', 'ts']);
    expect(callLines()).toEqual(['one --all']);
  });

  it('lint false disables the run; the format key is not read', async () => {
    lint(false);
    const r = await go(repo.cfg, ['-Lint', '-Language', 'ts']);
    expect(r).toMatchObject({ status: 0, stdout: 'skipped: disabled\n' });
    expect(callLines()).toEqual([]);
  });

  it('a failing command stops the run with its exit code and passes its stderr', async () => {
    lint({ dotnet: { command: ['bad {files}', 'one {files}'] } });
    const r = await go(repo.cfg, ['-Lint', '-Language', 'dotnet']);
    expect(r.status).toBe(5);
    expect(r.stderr).toContain('broken');
    expect(callLines()).toEqual(['bad A.cs B.cs']);
  });

  it('a configured tool that is missing is an error', async () => {
    lint({ dotnet: { command: 'nosuchlinter {files}' } });
    const r = await go(repo.cfg, ['-Lint', '-Language', 'dotnet']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('nosuchlinter not found');
  });

  it('an entry without command is an error', async () => {
    lint({ dotnet: { extensions: ['.cs'] } });
    const r = await go(repo.cfg, ['-Lint', '-Language', 'dotnet']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("has no 'command'");
  });

  it('a default whose probe fails is skipped, not an error', async () => {
    const r = await go(repo.langs, ['-Lint', '-Language', 'py'], bins.noProbe);
    expect(r).toMatchObject({ status: 0, stdout: 'skipped: ruff not configured\n' });
    expect(callLines()).toEqual([]);
  });

  it('-Lint with -Check is rejected', async () => {
    const r = await go(repo.langs, ['-Lint', '-Check', '-Language', 'py']);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('cannot be combined');
  });

  it('-WhatIf prints the lint steps and runs nothing', async () => {
    const r = await go(repo.langs, ['-Lint', '-Language', 'rust', '-WhatIf']);
    expect(JSON.parse(r.stdout)).toEqual([
      {
        tool: 'cargo',
        extensions: ['.rs'],
        requires: 'cargo clippy --version',
        commands: ['cargo clippy --all-targets -- -D warnings'],
      },
    ]);
    expect(callLines()).toEqual([]);
  });
});
