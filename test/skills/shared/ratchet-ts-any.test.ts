import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(root, 'skills/shared/ratchet/templates/check-ts-any-ratchet.mts');
const HELPER = path.join(root, 'skills/shared/ratchet/scripts/baseline.mts');

describe('ratchet check-ts-any-ratchet.mts', () => {
  let tmp: string;
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), text);
  };
  const baseline = () =>
    JSON.parse(fs.readFileSync(path.join(tmp, 'scripts/ratchets/baselines/ts-any.json'), 'utf8'));
  const run = (...flags: string[]) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...flags], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, RATCHET_BASELINE_HELPER: HELPER },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-any-'));
    write('src/a.ts', 'let a: any = 1;\nconst b = a as any;\nconst c = <any>a;\n');
    write('src/b.tsx', '// @ts-nocheck\n/* @ts-ignore */\nfunction f(x: any[]) {}\n');
    write(
      'src/c.mts',
      'export const ok = 1;\n// a: any in a comment\nconst s = "x: any as any";\n',
    );
    write(
      'src/d.ts',
      "const t = `x: any ${a as any} <any> ${`n: any`}`;\nconst re = 'it\\'s any'; let z: any;\n",
    );
    write('src/e.js', 'let a: any;\n');
    write('node_modules/dep/index.ts', 'let a: any;\n');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('counts the forms per file and ignores comments, strings and other files', () => {
    expect(run('--init').status).toBe(0);
    expect(baseline()).toEqual({ 'src/a.ts': 3, 'src/b.tsx': 3, 'src/d.ts': 2 });
    expect(run().status).toBe(0);
  });

  it('fails on a higher count and on a new file', () => {
    run('--init');
    write('src/a.ts', 'let a: any; let b: any; let c: any; let d: any;\n');
    const higher = run();
    expect(higher.status).toBe(1);
    expect(higher.out).toContain('src/a.ts');
    expect(run('--prune').status).toBe(1);
    write('src/a.ts', '');
    write('src/new.ts', '// @ts-ignore\n');
    expect(run().out).toContain('src/new.ts');
  });

  it('fails as stale on a lower count, until pruned', () => {
    run('--init');
    write('src/a.ts', 'let a: any;\n');
    const stale = run();
    expect(stale.status).toBe(1);
    expect(stale.out).toContain('src/a.ts');
    expect(run('--prune').status).toBe(0);
    expect(baseline()['src/a.ts']).toBe(1);
    expect(run().status).toBe(0);
  });
});
