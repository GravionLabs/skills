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

describe.skipIf(!hasPwsh || process.platform === 'win32')('Format-Changed.ps1', () => {
  let worker: PwshWorker;
  let tmp: string;
  // fake tools on PATH: `ok` probes (`--version`) pass, `bad` probes fail, `gitOnly` has nothing but git
  const bins = { ok: '', bad: '', gitOnly: '' };
  // fixture repos shared by all cases: the cases only write the call log (outside every repo) and .agents/ of `cfg`
  const repo = { langs: '', biome: '', clean: '', work: '', cfg: '', nohead: '', nogit: '' };
  const log = () => path.join(tmp, 'calls.log');

  const git = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd });
  const commit = (cwd: string) =>
    git(cwd, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'c');
  const write = (cwd: string, rel: string, c = 'x') => {
    fs.mkdirSync(path.dirname(path.join(cwd, rel)), { recursive: true });
    fs.writeFileSync(path.join(cwd, rel), c);
  };
  const mkdir = (name: string) => fs.mkdtempSync(path.join(tmp, `${name}-`));
  // a repo with `committed` in its first commit (none: no HEAD) and `untracked` left as they are
  const mkRepo = (name: string, committed: string[], untracked: string[]) => {
    const d = mkdir(name);
    git(d, 'init', '-q', '-b', 'main');
    for (const f of committed) write(d, f);
    if (committed.length) {
      git(d, 'add', '-A');
      commit(d);
    }
    for (const f of untracked) write(d, f);
    return d;
  };

  beforeAll(() => {
    worker = new PwshWorker(SCRIPT);
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fmt-')));
    // every fake tool appends one line per call to $FAKE_LOG: its name and its arguments, tab-separated (probes are not logged)
    for (const [k, probe] of [
      ['ok', 0],
      ['bad', 1],
    ] as const) {
      bins[k] = mkdir(`bin-${k}`);
      for (const name of [
        'npx',
        'uv',
        'dotnet',
        'cargo',
        'gofmt',
        'fmt',
        'jb',
        'dflt',
        'one',
        'two',
        'bad',
      ])
        fs.writeFileSync(
          path.join(bins[k], name),
          `#!/bin/sh\ncase "$*" in *--version*) exit ${probe};; esac\n` +
            `{ printf '%s' ${name}; for a in "$@"; do printf '\\t%s' "$a"; done; echo; } >> "$FAKE_LOG"\n` +
            (name === 'bad' ? 'echo broken >&2; exit 5\n' : ''),
          { mode: 0o755 },
        );
    }
    // CI images ship gofmt in /usr/bin, so /usr/bin:/bin cannot stay on PATH for the missing-tool case: only git is linked in
    bins.gitOnly = mkdir('bin-git');
    const gitPath = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
    fs.symlinkSync(gitPath, path.join(bins.gitOnly, 'git'));

    // one changed file per language; sub/biome.json is no Biome project (not at the toplevel), prettier takes it as json
    repo.langs = mkRepo(
      'langs',
      ['README.md'],
      [
        'a.ts',
        'b.json',
        'c.html',
        'd.scss',
        'e.py',
        'F.cs',
        'src/lib.rs',
        'cmd/app/main.go',
        'n.md',
        'sub/biome.json',
      ],
    );
    repo.biome = mkRepo('biome', ['biome.jsonc'], ['a.html', 'b.ts', 'c.json', 'n.md']);
    repo.clean = mkRepo('clean', ['base.ts'], ['n.md']);
    // branch feat has c.ts committed since main; the working tree has every kind of change
    repo.work = mkRepo('work', ['base.ts', 'gone.ts', 'staged.ts'], []);
    git(repo.work, 'checkout', '-qb', 'feat');
    write(repo.work, 'c.ts');
    git(repo.work, 'add', 'c.ts');
    commit(repo.work);
    write(repo.work, 'base.ts', 'changed'); // unstaged
    fs.rmSync(path.join(repo.work, 'gone.ts')); // deleted: dropped
    write(repo.work, 'staged.ts', 'changed');
    git(repo.work, 'add', 'staged.ts');
    for (const f of ['-rf.ts', 'Größe über.ts', 'c;d.ts', 'n.md']) write(repo.work, f); // untracked
    repo.cfg = mkRepo('cfg', ['README.md'], ['a.ts', 'A.cs']);
    repo.nohead = mkRepo('nohead', [], ['n.ts', 'u.ts']);
    git(repo.nohead, 'add', 'n.ts');
    repo.nogit = mkdir('nogit');
    write(repo.nogit, 'a.ts');
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  beforeEach(() => {
    fs.rmSync(log(), { force: true });
    fs.rmSync(path.join(repo.cfg, '.agents'), { recursive: true, force: true });
  });

  const go = (cwd: string, args: string[], bin = bins.ok, env: NodeJS.ProcessEnv = {}) =>
    worker.run(args, {
      cwd,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_LOG: log(), ...env },
    });
  // the logged calls, each as its argv (tool name first)
  const calls = (): string[][] =>
    fs.existsSync(log())
      ? fs
          .readFileSync(log(), 'utf8')
          .trimEnd()
          .split('\n')
          .map((l) => l.split('\t'))
      : [];
  const callLines = () => calls().map((c) => c.join(' '));
  type Conf = { config?: unknown; format?: unknown };
  const conf = (c: Conf) => {
    for (const [file, o] of Object.entries(c))
      write(repo.cfg, `.agents/${file}.json`, typeof o === 'string' ? o : JSON.stringify(o));
  };
  const ts = ['-Language', 'ts', '-Extensions', '.ts'];

  // built-in defaults: a format run per language; -Check runs once per toolchain (prettier/eslint, Biome), the other check
  // commands are data pinned by format-defaults-sync. The Biome rows run in the repo with biome.jsonc at the toplevel
  const defaults = [
    [
      'ts',
      'langs',
      3,
      [
        'npx --no-install prettier --write a.ts b.json sub/biome.json',
        'npx --no-install eslint --fix a.ts',
      ],
      [
        'npx --no-install prettier --check a.ts b.json sub/biome.json',
        'npx --no-install eslint a.ts',
      ],
    ],
    [
      'ng',
      'langs',
      5,
      [
        'npx --no-install prettier --write a.ts b.json c.html d.scss sub/biome.json',
        'npx --no-install eslint --fix a.ts',
      ],
      [
        'npx --no-install prettier --check a.ts b.json c.html d.scss sub/biome.json',
        'npx --no-install eslint a.ts',
      ],
    ],
    [
      'py',
      'langs',
      1,
      ['uv run ruff format e.py', 'uv run ruff check --fix e.py'],
      ['uv run ruff format --check e.py', 'uv run ruff check e.py'],
    ],
    [
      'dotnet',
      'langs',
      1,
      ['dotnet format --include F.cs'],
      ['dotnet format --verify-no-changes --include F.cs'],
    ],
    ['rust', 'langs', 1, ['cargo fmt -- src/lib.rs'], ['cargo fmt -- --check src/lib.rs']],
    ['go', 'langs', 1, ['gofmt -w cmd/app/main.go'], ['gofmt -l cmd/app/main.go']],
    ['ts', 'biome', 2, ['npx biome check --write b.ts c.json'], ['npx biome check b.ts c.json']],
    [
      'ng',
      'biome',
      3,
      ['npx biome check --write a.html b.ts c.json'],
      ['npx biome check a.html b.ts c.json'],
    ],
  ] as const;
  it.each(defaults)('default %s (%s repo) runs its format commands', async (lang, r, n, format) => {
    const f = await go(repo[r], ['-Language', lang]);
    expect(f).toMatchObject({ status: 0, stdout: `formatted: ${n} files\n` });
    expect(callLines()).toEqual(format);
  });
  it.each(defaults.filter(([lang]) => lang === 'ts'))(
    'default %s (%s repo) -Check runs its check commands',
    async (lang, r, n, _format, check) => {
      const c = await go(repo[r], ['-Language', lang, '-Check']);
      expect(c).toMatchObject({ status: 0, stdout: `checked: ${n} files\n` });
      expect(callLines()).toEqual(check);
    },
  );

  // explicit -Command (with a passing -Requires probe): staged, unstaged and untracked files of the extensions, deleted and
  // .md dropped, branch commits (c.ts) only with -Base; names with spaces, non-ASCII or ';' intact, a leading '-' prefixed
  const files = ['base.ts', 'staged.ts', './-rf.ts', 'Größe über.ts', 'c;d.ts'];
  it.each([
    [
      'a {files} token',
      'fmt --write {files} --end',
      [],
      'formatted: 5',
      ['--write', ...files, '--end'],
    ],
    [
      'no placeholder (appended), -Check',
      'fmt --fix',
      ['-Check'],
      'checked: 5',
      ['--fix', ...files],
    ],
    [
      'an embedded {files} (joined by ;)',
      'fmt --include={files}',
      [],
      'formatted: 5',
      [`--include=${files.join(';')}`],
    ],
    ['-Base main', 'fmt {files}', ['-Base', 'main'], 'formatted: 6', ['c.ts', ...files]],
  ])('-Command with %s passes the changed files', async (_n, cmd, extra, out, argv) => {
    const r = await go(repo.work, [
      '-Extensions',
      'ts,TSX',
      '-Command',
      cmd,
      '-Requires',
      'fmt --version',
      ...extra,
    ]);
    expect(r).toMatchObject({ status: 0, stdout: `${out} files\n` });
    expect(calls()).toEqual([['fmt', ...argv]]);
  });

  it.each([
    [
      'a failing default probe (ruff, not uv)',
      'langs',
      ['-Language', 'py'],
      'bad',
      'ruff not configured',
    ],
    ['a failing biome probe', 'biome', ['-Language', 'ts'], 'bad', 'biome not configured'],
    [
      'a failing -Requires probe',
      'langs',
      ['-Extensions', '.ts', '-Command', 'fmt {files}', '-Requires', 'fmt --version'],
      'bad',
      'fmt not configured',
    ],
    ['a missing default tool', 'langs', ['-Language', 'go'], 'gitOnly', 'gofmt not found'],
    [
      'a missing -Command tool',
      'langs',
      ['-Extensions', '.ts', '-Command', 'no-such-fmt --write {files}'],
      'ok',
      'no-such-fmt not found',
    ],
  ] as const)('skips a step by name for %s', async (_n, r, args, bin, out) => {
    const env = bin === 'gitOnly' ? { PATH: bins.gitOnly } : {};
    const res = await go(repo[r], [...args], bins[bin], env);
    expect(res).toMatchObject({ status: 0, stdout: `skipped: ${out}\n` });
    expect(calls()).toEqual([]);
  });

  it.each([
    ['a language without changed files', ['-Language', 'rust']],
    ['only other extensions changed', ['-Extensions', '.ts', '-Command', 'fmt {files}']],
  ])('skips with no changed files for %s', async (_n, args) => {
    const r = await go(repo.clean, args);
    expect(r).toMatchObject({ status: 0, stdout: 'skipped: no changed files\n' });
    expect(calls()).toEqual([]);
  });

  it.each([
    [
      'without a commit: index and untracked files',
      'nohead',
      'formatted: 2 files',
      [['fmt', 'n.ts', 'u.ts']],
    ],
    ['outside a git repository: skipped', 'nogit', 'skipped: not a git repository', []],
  ] as const)('runs %s', async (_n, r, out, expected) => {
    const env = { GIT_CEILING_DIRECTORIES: path.dirname(repo.nogit) };
    const res = await go(repo[r], ['-Extensions', '.ts', '-Command', 'fmt {files}'], bins.ok, env);
    expect(res).toMatchObject({ status: 0, stdout: `${out}\n` });
    expect(calls()).toEqual(expected);
  });

  it('passes a failing exit code and stderr through and stops at the failing command', async () => {
    conf({
      config: {
        format: { ts: { format: 'x', check: ['one {files}', 'bad {files}', 'two {files}'] } },
      },
    });
    const r = await go(repo.cfg, [...ts, '-Check']);
    expect(r.status).toBe(5);
    expect(r.stderr).toContain('broken');
    expect(r.stdout).not.toContain('checked');
    expect(callLines()).toEqual(['one a.ts', 'bad a.ts']);
  });

  it('runs the .agents/config.json format.<lang> entry over -Command, -Requires and the defaults', async () => {
    conf({
      config: {
        format: {
          dotnet: {
            extensions: ['.cs'],
            format: ['jb fmt {files}', 'two {files}'],
            check: 'jb chk {files}',
          },
        },
      },
    });
    // bins.bad: a probe would fail, the override runs without one
    const args = [
      '-Language',
      'dotnet',
      '-Extensions',
      '.ts',
      '-Command',
      'dflt {files}',
      '-Requires',
      'jb --version',
    ];
    const f = await go(repo.cfg, args, bins.bad);
    expect(f).toMatchObject({ status: 0, stdout: 'formatted: 1 files\n' });
    expect(f.stderr).toContain("notice: running commands from .agents/config.json for 'dotnet'");
    expect(callLines()).toEqual(['jb fmt A.cs', 'two A.cs']);
    fs.rmSync(log());
    const c = await go(repo.cfg, ['-Language', 'dotnet', '-Check']);
    expect(c).toMatchObject({ status: 0, stdout: 'checked: 1 files\n' });
    expect(callLines()).toEqual(['jb chk A.cs']);
  });

  it.each([
    ['format', { config: { format: false } }, []],
    [
      '-Check, over a legacy .agents/format.json',
      { config: { format: false }, format: { ts: { format: 'jb {files}' } } },
      ['-Check'],
    ],
  ])('"format": false skips %s as disabled', async (_n, c, extra) => {
    conf(c);
    const r = await go(repo.cfg, [...ts, '-Command', 'dflt {files}', ...extra]);
    expect(r).toMatchObject({ status: 0, stdout: 'skipped: disabled\n' });
    expect(calls()).toEqual([]);
  });

  it.each([
    [
      'config.json has no format key: the legacy file applies, deprecated',
      { config: {}, format: { ts: { format: 'jb old {files}' } } },
      'jb old a.ts',
      /format\.json is deprecated.*\.agents\/config\.json[\s\S]*running commands from \.agents\/format\.json/,
    ],
    [
      'both define format: config.json wins',
      {
        config: { format: { ts: { format: 'jb new {files}' } } },
        format: { ts: { format: 'jb old {files}' } },
      },
      'jb new a.ts',
      /both define format.*config\.json wins/,
    ],
  ])('legacy .agents/format.json: %s', async (_n, c, call, notice) => {
    conf(c);
    const r = await go(repo.cfg, ts);
    expect(r).toMatchObject({ status: 0, stdout: 'formatted: 1 files\n' });
    expect(r.stderr).toMatch(notice);
    expect(callLines()).toEqual([call]);
  });

  it.each([
    ['no -Language: the config is not read', { config: '{ nope' }, ['-Extensions', '.ts']],
    ['no format key', { config: { $schema: 'https://example.com/s.json' } }, ts],
    [
      'an entry only for another language',
      { config: { format: { py: { format: 'jb {files}' } } } },
      ts,
    ],
    ['a legacy file that is not an object', { format: [1] }, ts],
    ['no config: explicit -Command over the ts default', {}, ts],
  ])('runs -Command when no entry applies: %s', async (_n, c, args) => {
    conf(c);
    const r = await go(repo.cfg, [...args, '-Command', 'dflt {files}']);
    expect(r).toMatchObject({ status: 0, stdout: 'formatted: 1 files\n' });
    expect(callLines()).toEqual(['dflt a.ts']);
  });

  const jb = [...ts, '-Command', 'jb {files}'];
  it.each([
    ['config.json is not valid JSON', { config: '{ nope' }, jb, /config\.json is not valid JSON/],
    ['config.json is not an object', { config: [1] }, jb, /config\.json must be a JSON object/],
    [
      'an unknown top-level key',
      { config: { frmat: {} } },
      jb,
      /config\.json: unknown key 'frmat'/,
    ],
    [
      'format is a string',
      { config: { format: 'jb {files}' } },
      jb,
      /key 'format' must be false or a map/,
    ],
    ['format is true', { config: { format: true } }, jb, /key 'format' must be false or a map/],
    [
      'the entry is not an object',
      { config: { format: { ts: 'jb {files}' } } },
      jb,
      /config\.json: entry 'ts' has no 'format' command/,
    ],
    [
      'the entry lacks the -Check key',
      { config: { format: { ts: { format: 'jb {files}' } } } },
      [...jb, '-Check'],
      /config\.json: entry 'ts' has no 'check' command/,
    ],
    [
      'the command list is empty',
      { config: { format: { ts: { format: [] } } } },
      jb,
      /empty 'format' command/,
    ],
    [
      'the command is blank',
      { config: { format: { ts: { format: ' ' } } } },
      jb,
      /empty 'format' command/,
    ],
    [
      'the legacy file is not valid JSON',
      { format: '{ nope' },
      jb,
      /format\.json is not valid JSON/,
    ],
    [
      'a configured tool is missing',
      { config: { format: { ts: { format: ['jb {files}', 'no-such-jb {files}'] } } } },
      jb,
      /no-such-jb not found \(configured in \.agents\/config\.json for ts\)/,
    ],
    [
      'neither the entry nor the call has extensions',
      { config: { format: { ts: { format: 'jb {files}' } } } },
      ['-Language', 'ts'],
      /-Extensions is required/,
    ],
    ['an unknown language without -Command', {}, ['-Language', 'cobol'], /-Command is required/],
    ['-Command without -Extensions', {}, ['-Command', 'jb {files}'], /-Extensions is required/],
  ])('fails when %s', async (_n, c, args, re) => {
    conf(c);
    const r = await go(repo.cfg, args);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(re);
    expect(r.stdout).toBe('');
    expect(calls()).toEqual([]);
  });

  it('fails with the git error for an invalid -Base, nothing checked', async () => {
    const r = await go(repo.work, [
      '-Extensions',
      '.ts',
      '-Command',
      'fmt {files}',
      '-Base',
      'no-such-ref',
      '-Check',
    ]);
    expect(r.status).not.toBe(0);
    expect(r.stdout).toBe('');
    expect(r.stderr).toMatch(/no-such-ref|unknown revision/);
    expect(calls()).toEqual([]);
  });

  it('-WhatIf prints the resolved steps as JSON and runs nothing', async () => {
    const d = await go(repo.langs, ['-Language', 'ts', '-Check', '-WhatIf']);
    expect(d.status).toBe(0);
    expect(JSON.parse(d.stdout)).toEqual([
      {
        tool: 'prettier',
        extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs', '.json'],
        requires: 'npx --no-install prettier --version',
        commands: ['npx --no-install prettier --check {files}'],
      },
      {
        tool: 'eslint',
        extensions: ['.ts', '.tsx', '.js', '.mjs', '.cjs'],
        requires: 'npx --no-install eslint --version',
        commands: ['npx --no-install eslint {files}'],
      },
    ]);
    const c = await go(repo.langs, ['-Extensions', '.ts', '-Command', 'fmt {files}', '-WhatIf']);
    expect(JSON.parse(c.stdout)).toEqual([
      { tool: null, extensions: ['.ts'], requires: null, commands: ['fmt {files}'] },
    ]);
    conf({ config: { format: false } });
    const off = await go(repo.cfg, [...ts, '-WhatIf']);
    expect(JSON.parse(off.stdout)).toEqual([]);
    expect(calls()).toEqual([]);
  });
});
