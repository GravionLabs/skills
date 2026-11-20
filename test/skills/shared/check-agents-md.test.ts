import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(root, 'skills/shared/agents-md/scripts/check-agents-md.mts');

const run = (cwd: string, ...args: string[]) => {
  const r = spawnSync(process.execPath, [SCRIPT, cwd, ...args], { encoding: 'utf8' });
  return { status: r.status, out: r.stdout, err: r.stderr };
};

describe('check-agents-md.mts', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-md-'));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const repo = (name: string, files: Record<string, string>): string => {
    const dir = path.join(tmp, name);
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    return dir;
  };
  const ref = 'docs/agents-md-refs/release.md';

  it('a file within budget with a conditioned reference passes', () => {
    const dir = repo('ok', {
      'AGENTS.md': `# P\n\n## Read before\n\n- Before changing the release, read \`${ref}\`.\n`,
      [ref]: '# Release\n',
    });
    const r = run(dir);
    expect(r.status).toBe(0);
    expect(r.out).toMatch(/^AGENTS\.md: \d+ \/ 8000$/m);
  });

  it('a file over the budget exits 1 and names path and size; --budget overrides', () => {
    const dir = repo('over', { 'AGENTS.md': 'x'.repeat(8001) });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.out).toContain('AGENTS.md: 8001 / 8000');
    expect(run(dir, '--budget', '9000').status).toBe(0);
  });

  it('reports an unreferenced file, a reference without condition and a missing target', () => {
    const dir = repo('bad', {
      'AGENTS.md': [
        'See `docs/agents-md-refs/nocond.md` for details.',
        'Before X, read `docs/agents-md-refs/gone.md`.',
        '',
      ].join('\n'),
      'docs/agents-md-refs/nocond.md': '# a\n',
      'docs/agents-md-refs/orphan.md': '# b\n',
      'packages/a/AGENTS.md': 'x'.repeat(8100),
      'node_modules/p/AGENTS.md': 'x'.repeat(9000),
      '.wt/AGENTS.md': 'x'.repeat(9000),
    });
    const r = run(dir, '--json');
    expect(r.status).toBe(1);
    const report = JSON.parse(r.out);
    const kinds = report.problems.map((p: { kind: string; file: string }) => `${p.kind} ${p.file}`);
    expect(kinds.sort()).toEqual([
      'missing AGENTS.md',
      'no-condition AGENTS.md',
      'over-budget packages/a/AGENTS.md',
      'unreferenced docs/agents-md-refs/orphan.md',
    ]);
    expect(report.files.map((f: { path: string }) => f.path)).toEqual([
      'AGENTS.md',
      'packages/a/AGENTS.md',
    ]);
    expect(report.ok).toBe(false);
  });

  it('rejects a bad --budget', () => {
    expect(run(tmp, '--budget', 'x').status).toBe(2);
  });

  it('without a repository argument it uses the git toplevel', () => {
    const r = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd: root, encoding: 'utf8' });
    expect(JSON.parse(r.stdout).root).toBe(root);
  });
});
