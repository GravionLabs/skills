import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Ajv from 'ajv/dist/2020';

const root = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(root, 'skills/shared/code-review/scripts/ConvertTo-Findings.ps1');
const schema = JSON.parse(
  fs.readFileSync(path.join(root, 'test/fixtures/poimen-findings.schema.json'), 'utf8'),
);
const validate = new Ajv({ allErrors: true }).compile(schema);
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

const SHA = 'b18a36c0f1e2d3c4b5a69788796a5b4c3d2e1f00';
const review = {
  blocking: [
    { file: 'a.ts', line: 3, title: 'null deref', why: 'crashes', rule: 'spec-drift' },
    { file: 'b.ts', line: 9, title: 'leak', why: 'handle not closed' },
  ],
  notes: ['rename x'],
  unmet: ['file is written'],
};

describe.skipIf(!hasPwsh)('ConvertTo-Findings.ps1', () => {
  let tmp: string;
  const run = (args: string[]) =>
    spawnSync('pwsh', ['-NoProfile', '-File', SCRIPT, ...args], { encoding: 'utf8' });
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'findings-'));
    fs.writeFileSync(path.join(tmp, 'review.json'), JSON.stringify(review));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('prints poimen-shaped JSON to stdout with the mapping', () => {
    const r = run(['-Review', path.join(tmp, 'review.json'), '-Sha', SHA]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(validate(out), JSON.stringify(validate.errors)).toBe(true);
    expect(out).toMatchObject({ version: 1, sha: SHA, source: 'deliver' });
    expect(out.findings).toEqual([
      {
        file: 'a.ts',
        line: 3,
        severity: 'blocking',
        title: 'null deref',
        why: 'crashes',
        rule: 'spec-drift',
      },
      { file: 'b.ts', line: 9, severity: 'blocking', title: 'leak', why: 'handle not closed' },
      expect.objectContaining({
        severity: 'blocking',
        title: expect.stringContaining('file is written'),
      }),
      { severity: 'note', title: 'rename x', why: 'rename x' },
    ]);
    expect(out.findings[2]).not.toHaveProperty('file');
    expect(out.findings[3]).not.toHaveProperty('line');
  });

  it('a clean review gives an empty, valid findings array', () => {
    fs.writeFileSync(path.join(tmp, 'clean.json'), '{"blocking":[],"notes":[]}');
    const r = run([
      '-Review',
      path.join(tmp, 'clean.json'),
      '-Sha',
      SHA.slice(0, 7),
      '-Source',
      'x',
    ]);
    const out = JSON.parse(r.stdout);
    expect(validate(out)).toBe(true);
    expect(out.findings).toEqual([]);
  });

  it('rejects a bad sha', () => {
    expect(run(['-Review', path.join(tmp, 'review.json'), '-Sha', 'zz']).status).not.toBe(0);
  });

  it('writes the file into the worktree and excludes .agents/state/ once', () => {
    const repo = path.join(tmp, 'repo');
    fs.mkdirSync(repo);
    expect(spawnSync('git', ['-C', repo, 'init', '-q']).status).toBe(0);
    for (let i = 0; i < 2; i++) {
      const r = run(['-Review', path.join(tmp, 'review.json'), '-Sha', SHA, '-Worktree', repo]);
      expect(r.status, r.stderr).toBe(0);
    }
    const file = path.join(repo, '.agents/state/findings.json');
    expect(validate(JSON.parse(fs.readFileSync(file, 'utf8')))).toBe(true);
    const exclude = fs.readFileSync(path.join(repo, '.git/info/exclude'), 'utf8');
    expect(exclude.split('\n').filter((l) => l === '.agents/state/')).toHaveLength(1);
    const st = spawnSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' });
    expect(st.stdout).toBe('');
  });

  it('leaves exclude alone when already ignored', () => {
    const repo = path.join(tmp, 'repo2');
    fs.mkdirSync(repo);
    spawnSync('git', ['-C', repo, 'init', '-q']);
    fs.writeFileSync(path.join(repo, '.gitignore'), '.agents/state/\n');
    run(['-Review', path.join(tmp, 'review.json'), '-Sha', SHA, '-Worktree', repo]);
    const ex = path.join(repo, '.git/info/exclude');
    expect(fs.readFileSync(ex, 'utf8')).not.toContain('.agents/state/');
  });
});

describe('findings docs', () => {
  it('deliver, contract and delivery doc name the mapping', () => {
    const rd = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
    expect(rd('skills/delivery/deliver/SKILL.md')).toContain('ConvertTo-Findings.ps1');
    expect(rd('skills/shared/code-review/references/reviewer-contract.md')).toContain('findings');
    expect(rd('docs/delivery.md')).toContain('.agents/state/findings.json');
    expect(rd('docs/delivery.md')).toContain('poimen');
  });
});
