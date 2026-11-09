import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'yaml';
import { createFakeGh } from '../../helpers/fake-gh';
import { PwshWorker } from '../../helpers/pwsh-worker';
import { expectSkillHelp } from '../../helpers/skill-help';

const skillDir = path.resolve(__dirname, '../../../skills/github/github-pages');
const script = path.join(skillDir, 'scripts/Initialize-GithubPages.ps1');

// FAKE_PAGES: JSON of an existing Pages site, unset = 404
const handler = `(call) => {
  const a = call.args;
  if (a[0] === 'repo') return { rest: 'o/r' };
  if (a.includes('-X')) return { rest: {} };
  if (a[1] === 'repos/o/r/pages') {
    if (!process.env.FAKE_PAGES) throw new Error('404 Not Found');
    return { rest: JSON.parse(process.env.FAKE_PAGES) };
  }
  throw new Error('unexpected ' + a.join(' '));
}`;

describe('github-pages skill', () => {
  it('follows the help convention and stays within 100 lines', () => {
    expectSkillHelp(skillDir);
    const text = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    expect(text.split('\n').length).toBeLessThanOrEqual(101);
    for (const term of ['site/', 'docs/', '<!--@include: ../../SPEC.md-->', 'never published']) {
      expect(text).toContain(term);
    }
  });

  it('has a valid workflow template calling the ci workflow', () => {
    const raw = fs.readFileSync(path.join(skillDir, 'templates/workflows/pages.yml'), 'utf8');
    const wf = parse(raw);
    const job = wf.jobs.pages;
    expect(job.uses).toBe('GravionLabs/ci/.github/workflows/vitepress-pages.yml@v1');
    expect(Object.keys(job.with)).toEqual(
      expect.arrayContaining(['site-path', 'package-manager', 'pre-build', 'deploy']),
    );
  });

  it('has site templates: package.json scripts, config base and dead links', () => {
    const t = path.join(skillDir, 'templates/site');
    const pkg = JSON.parse(fs.readFileSync(path.join(t, 'package.json'), 'utf8'));
    expect(Object.keys(pkg.scripts)).toEqual(expect.arrayContaining(['dev', 'build', 'test']));
    expect(Object.keys(pkg.devDependencies)).toEqual(
      expect.arrayContaining(['vitepress', 'vitest']),
    );
    const cfg = fs.readFileSync(path.join(t, '.vitepress/config.mts'), 'utf8');
    expect(cfg).toContain("process.env['SITE_BASE'] ?? '/'");
    expect(cfg).toContain('ignoreDeadLinks: false');
    for (const f of ['index.md', '.vitepress/theme/index.ts', 'tests/config.spec.ts']) {
      expect(fs.existsSync(path.join(t, f))).toBe(true);
    }
  });
});

describe('Initialize-GithubPages.ps1', () => {
  let worker: PwshWorker;
  let tmp: string;
  let fake: ReturnType<typeof createFakeGh>;
  beforeAll(() => {
    worker = new PwshWorker(script);
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-'));
    fake = createFakeGh(tmp, handler);
  });
  afterAll(() => worker.close());

  const repoDir = () => fs.mkdtempSync(path.join(tmp, 'repo-'));
  const run = (cwd: string, args: string[], pages?: object) => {
    const before = fake.calls().length;
    return worker
      .run(args, {
        cwd,
        env: { ...fake.env(), ...(pages ? { FAKE_PAGES: JSON.stringify(pages) } : {}) },
      })
      .then((r) => ({
        r,
        writes: fake
          .calls()
          .slice(before)
          .filter((c) => c.args.includes('-X')),
      }));
  };

  it('dry run reports and writes nothing', async () => {
    const dir = repoDir();
    const { r, writes } = await run(dir, ['-DryRun', '-Repo', 'o/r']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('pages source: workflow (would set)');
    expect(fs.existsSync(path.join(dir, 'site'))).toBe(false);
    expect(writes).toEqual([]);
  });

  it('creates the files, sets the source with POST and honors the package manager', async () => {
    const dir = repoDir();
    const { r, writes } = await run(dir, ['-PackageManager', 'npm', '-Repo', 'o/r']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('pages source: workflow (set)');
    expect(writes.map((c) => c.args.slice(0, 4))).toEqual([
      ['api', '-X', 'POST', 'repos/o/r/pages'],
    ]);
    expect(writes[0].args).toContain('build_type=workflow');
    expect(fs.existsSync(path.join(dir, 'site/.vitepress/config.mts'))).toBe(true);
    const wf = fs.readFileSync(path.join(dir, '.github/workflows/pages.yml'), 'utf8');
    expect(parse(wf).jobs.pages.with['package-manager']).toBe('npm');
  });

  it('existing Pages: unchanged when workflow, PUT otherwise; existing files are skipped', async () => {
    const dir = repoDir();
    fs.mkdirSync(path.join(dir, 'site'));
    fs.writeFileSync(path.join(dir, 'site/index.md'), 'mine');
    const same = await run(dir, ['-Repo', 'o/r'], { build_type: 'workflow' });
    expect(same.r.stdout).toContain('site/: skipped (exists)');
    expect(same.r.stdout).toContain('pages source: workflow (unchanged)');
    expect(same.writes).toEqual([]);
    expect(fs.readFileSync(path.join(dir, 'site/index.md'), 'utf8')).toBe('mine');
    const legacy = await run(dir, ['-Repo', 'o/r'], { build_type: 'legacy' });
    expect(legacy.r.stdout).toContain('.github/workflows/pages.yml: skipped (exists)');
    expect(legacy.r.stdout).toContain('pages source: workflow (set)');
    expect(legacy.writes[0].args.slice(0, 4)).toEqual(['api', '-X', 'PUT', 'repos/o/r/pages']);
  });
});
