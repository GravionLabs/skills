import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const repo = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(repo, 'skills/skill-slim/scripts/Get-SkillReport.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

describe.skipIf(!hasPwsh || process.platform === 'win32')('Get-SkillReport.ps1 (#775)', () => {
  let worker: PwshWorker;
  let dir: string;
  beforeAll(() => {
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(() => worker.close());
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'skill-report-')));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (rel: string, content = 'x\n') => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  const skill = (name: string, body: string) =>
    write(`skills/${name}/SKILL.md`, `---\nname: ${name}\n---\n\n${body}\n`);
  const run = async (...args: string[]) => {
    const r = await worker.run(['-Root', dir, '-Allowlist', path.join(dir, 'allow.txt'), ...args], {
      cwd: dir,
    });
    return { ...r, report: r.stdout.trim() ? JSON.parse(r.stdout) : null };
  };
  const refs = (report: { danglingCandidates: { skill: string; ref: string }[] }) =>
    report.danglingCandidates.map((d) => `${d.skill}: ${d.ref}`);

  it('resolves every reference form and still exits 0 with dangling references without -FailOnDangling', async () => {
    // one sentence per form: same-sentence owner (missing, existing), <skill>/ and ../<skill>/ prefixes, a prefix of
    // another tool (not ours), repo-root paths against -Root, and references/*.md resolved against their own skill
    skill(
      'alpha',
      [
        'See `beta` `references/missing.md` for the tier.',
        'See `beta` `references/there.md` for the tier.',
        'Read `beta/references/gone.md`, `../beta/references/gone2.md` and `beta/references/ok.md`.',
        'Uses `vendor/scripts/run.sh` of a vendor.',
        'See `docs/there.md`, `docs/gone.md`, `AGENTS.md` and `scripts/tool.mjs`.',
      ].join('\n\n'),
    );
    skill('beta', 'Beta.');
    write('skills/beta/references/there.md');
    write('skills/beta/references/ok.md');
    write(
      'skills/alpha/references/r.md',
      'Needs `references/own-missing.md` and `references/r.md`.\n',
    );
    write('docs/there.md');
    write('scripts/tool.mjs');
    const r = await run();
    expect(r.status).toBe(0);
    expect(refs(r.report).sort()).toEqual([
      'alpha: AGENTS.md',
      'alpha: beta/references/gone.md',
      'alpha: beta/references/gone2.md',
      'alpha: beta/references/missing.md',
      'alpha: docs/gone.md',
      'alpha: references/own-missing.md',
    ]);
  });

  it('-FailOnDangling exits 1 for what the allowlist leaves', async () => {
    skill('alpha', 'See `beta` `references/missing.md`. See `beta` `references/known.md`.');
    skill('beta', 'Beta.');
    write('allow.txt', '# beta ships it at runtime\nalpha: beta/references/known.md  # why\n');
    const r = await run('-FailOnDangling');
    expect(r.status).toBe(1);
    expect(refs(r.report)).toEqual(['alpha: beta/references/missing.md']);
    expect(r.stderr).toContain('dangling references: 1');
  });

  // happy path: -FailOnDangling exits 0 on a clean tree
  it('this repository has no dangling references', async () => {
    const r = await worker.run(['-Root', repo, '-FailOnDangling'], { cwd: repo });
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).danglingCandidates).toEqual([]);
  });
});

describe('CI and skill-slim (#775)', () => {
  it('ci.yml passes -FailOnDangling and skill-slim documents the switch', () => {
    const ci = fs.readFileSync(path.join(repo, '.github/workflows/ci.yml'), 'utf-8');
    expect(ci).toMatch(/Get-SkillReport\.ps1 -Root \. -FailOnDangling/);
    const md = fs.readFileSync(path.join(repo, 'skills/skill-slim/SKILL.md'), 'utf-8');
    expect(md).toContain('-FailOnDangling');
    expect(md).toContain('skill-report-allowlist.txt');
  });
});
