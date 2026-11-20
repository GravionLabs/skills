import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const RUNNER = path.join(root, 'skills/shared/ratchet/scripts/run-ratchets.mts');
const TEMPLATE = path.join(root, 'skills/shared/ratchet/templates/check-example-ratchet.mts');

describe('ratchet run-ratchets.mts', () => {
  let tmp: string;
  let dir: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-runner-'));
    dir = path.join(tmp, 'scripts/ratchets');
    fs.mkdirSync(dir, { recursive: true });
    // Each script prints several lines with pauses, so interleaving would show without blocks.
    const body = (tag: string, code: number, extra = '') => `
const flags = process.argv.slice(2).join(' ');
for (let i = 0; i < 3; i++) { console.log('${tag} line ' + i + (flags ? ' flags=' + flags : '')); await new Promise((r) => setTimeout(r, 30)); }
${extra}
process.exit(${code});`;
    fs.writeFileSync(path.join(dir, 'check-good-ratchet.mts'), body('good', 0));
    fs.writeFileSync(
      path.join(dir, 'check-bad-ratchet.mts'),
      body('bad', 1, "console.error('Fix the violation');"),
    );
    fs.writeFileSync(path.join(dir, 'helper.mts'), 'process.exit(1);');
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const run = (...args: string[]) => {
    const r = spawnSync(process.execPath, [RUNNER, ...args], { cwd: tmp, encoding: 'utf8' });
    return { status: r.status, out: r.stdout, err: r.stderr };
  };

  it('runs both scripts, prints one block each and exits 1 with the fix named', () => {
    const r = run();
    expect(r.status).toBe(1);
    const good = r.out.indexOf('=== ratchet good: ok ===');
    const bad = r.out.indexOf('=== ratchet bad: FAILED (exit 1) ===');
    expect(good).toBeGreaterThanOrEqual(0);
    expect(bad).toBeGreaterThanOrEqual(0);
    const blocks = r.out.split(/(?==== ratchet )/).filter((b) => b.startsWith('==='));
    const goodBlock = blocks.find((b) => b.includes('ratchet good'))!;
    const badBlock = blocks.find((b) => b.includes('ratchet bad'))!;
    expect(goodBlock).toMatch(/good line 0\ngood line 1\ngood line 2/);
    expect(badBlock).toMatch(/bad line 0\nbad line 1\nbad line 2\nFix the violation/);
    expect(goodBlock).not.toContain('bad line');
    expect(r.out).toContain('1/2 ratchets passed');
    expect(r.out).toContain('Failed: bad');
  });

  it('--only runs one ratchet and exits with its status', () => {
    const r = run('--only', 'good');
    expect(r.status).toBe(0);
    expect(r.out).toContain('ratchet good: ok');
    expect(r.out).not.toContain('ratchet bad');
  });

  it.each(['--init', '--prune'])('%s is passed to the scripts', (flag) => {
    const r = run('--only', 'good', flag);
    expect(r.out).toContain(`good line 0 flags=${flag}`);
  });

  it('--dir selects another directory', () => {
    const other = path.join(tmp, 'other');
    fs.mkdirSync(other);
    fs.copyFileSync(
      path.join(dir, 'check-good-ratchet.mts'),
      path.join(other, 'check-x-ratchet.mts'),
    );
    const r = run('--dir', 'other', '--workers', '1');
    expect(r.status).toBe(0);
    expect(r.out).toContain('1/1 ratchets passed');
  });

  it.each([
    [['--only', 'nope'], 'no ratchet named'],
    [['--dir', 'missing'], 'directory not found'],
    [['--bogus'], 'unknown argument'],
    [['--init', '--prune'], 'cannot be combined'],
  ])('usage error %j exits 2', (args, text) => {
    const r = run(...args);
    expect(r.status).toBe(2);
    expect(r.err).toContain(text);
  });

  it('the template works with the baseline helper through the runner', () => {
    const proj = fs.mkdtempSync(path.join(tmp, 'proj-'));
    fs.mkdirSync(path.join(proj, 'scripts/ratchets/baselines'), { recursive: true });
    fs.mkdirSync(path.join(proj, 'src'));
    fs.mkdirSync(path.join(proj, '.agents/skills'), { recursive: true });
    fs.symlinkSync(
      path.join(root, 'skills/shared/ratchet'),
      path.join(proj, '.agents/skills/ratchet'),
    );
    fs.copyFileSync(TEMPLATE, path.join(proj, 'scripts/ratchets/check-no-todo-ratchet.mts'));
    fs.writeFileSync(path.join(proj, 'src/a.ts'), '// TODO\n');
    const go = (...a: string[]) =>
      spawnSync(process.execPath, [RUNNER, ...a], { cwd: proj, encoding: 'utf8' });
    expect(go('--init').status).toBe(0);
    expect(go().status).toBe(0);
    fs.writeFileSync(path.join(proj, 'src/b.ts'), '// TODO\n');
    const r = go();
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('Fix the violation');
  });
});
