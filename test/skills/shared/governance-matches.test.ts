import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(root, 'skills/shared/code-review/scripts/Get-GovernanceMatches.ps1');
const globCases: { glob: string; path: string; match: boolean }[] = JSON.parse(
  fs.readFileSync(path.join(root, 'test/fixtures/governance-globs.json'), 'utf8'),
);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

const gov = {
  adrDir: 'docs/adr',
  adrPaths: ['infra/**', 'docker-compose.yml'],
  specMap: { 'apps/bff/**': 'docs/specs/bff.md', 'apps/web/**': 'docs/specs/web.md' },
  specMode: 'require',
};

describe.skipIf(!hasPwsh)('Get-GovernanceMatches.ps1', () => {
  let worker: PwshWorker;
  let tmp: string;
  let repo: string;
  const git = (...args: string[]) => {
    const r = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  };
  const put = (f: string, c = 'x\n') => {
    fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
    fs.writeFileSync(path.join(repo, f), c);
  };
  const config = (c?: object) => {
    const f = path.join(repo, '.agents/config.json');
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (c) fs.writeFileSync(f, JSON.stringify(c));
    else fs.rmSync(f, { force: true });
  };
  // commits the files on a branch off main, returns to main
  const branch = (name: string, edit: () => void) => {
    git('checkout', '-q', '-b', name, 'main');
    edit();
    git('add', '-A');
    git('commit', '-q', '-m', name);
    git('checkout', '-q', 'main');
  };
  const run = async (br: string, g: object | null = gov) => {
    config(g === null ? undefined : { governance: g });
    git('checkout', '-q', br);
    const r = await worker.run(['-Base', 'main'], { cwd: repo });
    git('checkout', '-q', 'main');
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gov-'));
    repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    git('init', '-q', '-b', 'main');
    git('config', 'user.email', 't@t');
    git('config', 'user.name', 't');
    git('config', 'commit.gpgsign', 'false');
    for (const f of ['infra/old.tf', 'infra/gone.tf', 'apps/bff/a.ts', 'docs/specs/bff.md']) put(f);
    put('docs/adr/0001-first.md');
    git('add', '-A');
    git('commit', '-q', '-m', 'base');

    branch('adr-no-file', () => put('infra/main.tf', 'new\n'));
    branch('adr-with-file', () => {
      put('docker-compose.yml');
      put('docs/adr/0002-compose.md');
    });
    branch('rename', () =>
      fs.renameSync(path.join(repo, 'infra/old.tf'), path.join(repo, 'infra/new.tf')),
    );
    branch('delete', () => fs.rmSync(path.join(repo, 'infra/gone.tf')));
    branch('drift', () => put('apps/bff/a.ts', 'changed\n'));
    branch('drift-with-spec', () => {
      put('apps/bff/a.ts', 'changed\n');
      put('docs/specs/bff.md', 'changed\n');
    });
    branch('excluded', () => {
      put('apps/bff/a.test.ts');
      put('apps/bff/tests/b.ts');
      put('apps/bff/README.md');
    });
    branch('globs', () => {
      for (const c of globCases) put(c.path);
    });
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('prints governance false without the key and with a config without it', async () => {
    expect(await run('adr-no-file', null)).toEqual({ governance: false });
    config({ format: false });
    git('checkout', '-q', 'adr-no-file');
    const r = await worker.run(['-Base', 'main'], { cwd: repo });
    git('checkout', '-q', 'main');
    expect(JSON.parse(r.stdout)).toEqual({ governance: false });
  });

  it('reports an ADR match without an ADR file', async () => {
    const j = await run('adr-no-file');
    expect(j.governance).toBe(true);
    expect(j.adr).toEqual({ matched: ['infra/main.tf'], adrFiles: [] });
  });

  it('reports the added ADR file next to the match', async () => {
    const j = await run('adr-with-file');
    expect(j.adr).toEqual({
      matched: ['docker-compose.yml'],
      adrFiles: ['docs/adr/0002-compose.md'],
    });
  });

  it('counts a rename with its new path and a deletion', async () => {
    expect((await run('rename')).adr.matched).toEqual(['infra/new.tf']);
    expect((await run('delete')).adr.matched).toEqual(['infra/gone.tf']);
  });

  it('reports spec drift and a changed spec', async () => {
    const drift = (await run('drift')).spec.find((s: { glob: string }) => s.glob === 'apps/bff/**');
    expect(drift).toEqual({
      glob: 'apps/bff/**',
      spec: 'docs/specs/bff.md',
      changedFiles: ['apps/bff/a.ts'],
      specChanged: false,
    });
    const ok = (await run('drift-with-spec')).spec.find(
      (s: { glob: string }) => s.glob === 'apps/bff/**',
    );
    expect(ok.specChanged).toBe(true);
    expect(ok.changedFiles).toEqual(['apps/bff/a.ts']);
  });

  it('does not count test files and .md files under the glob', async () => {
    const j = await run('excluded');
    const bff = j.spec.find((s: { glob: string }) => s.glob === 'apps/bff/**');
    expect(bff.changedFiles).toEqual([]);
  });

  it.each(globCases.map((c) => [c.glob, c.path, c.match] as const))(
    'glob %s on %s matches: %s',
    async (glob, p, match) => {
      const j = await run('globs', { adrPaths: [glob] });
      expect(j.adr.matched.includes(p)).toBe(match);
    },
  );
});
