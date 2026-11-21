import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(
  root,
  'skills/shared/ratchet/templates/check-lint-suppressions-ratchet.mts',
);
const HELPER = path.join(root, 'skills/shared/ratchet/scripts/baseline.mts');

describe('ratchet check-lint-suppressions-ratchet.mts', () => {
  let tmp: string;
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), text);
  };
  const baseline = () =>
    JSON.parse(
      fs.readFileSync(path.join(tmp, 'scripts/ratchets/baselines/lint-suppressions.json'), 'utf8'),
    );
  const run = (...flags: string[]) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...flags], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, RATCHET_BASELINE_HELPER: HELPER },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-lint-'));
    write('src/a.ts', '// eslint-disable-next-line no-console\nx();\n/* eslint-disable */\n');
    write(
      'src/b.ts',
      '// oxlint-disable-next-line no-debugger\n// biome-ignore lint/suspicious: reason\n',
    );
    write(
      'src/lib.rs',
      '#[allow(dead_code)]\nfn a() {}\n#[expect(unused, reason = "x")]\nfn b() {}\n#![allow(clippy::all)]\n',
    );
    write('src/C.cs', '#pragma warning disable CS0168\nint x;\n#pragma warning restore CS0168\n');
    write('src/clean.ts', 'export const ok = 1;\n');
    write('node_modules/dep/index.js', '// eslint-disable\n');
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('counts every form per file, one fixture per language', () => {
    expect(run('--init').status).toBe(0);
    expect(baseline()).toEqual({ 'src/C.cs': 1, 'src/a.ts': 2, 'src/b.ts': 2, 'src/lib.rs': 3 });
    expect(run().status).toBe(0);
  });

  it('fails on a higher count and on a new file', () => {
    run('--init');
    write('src/lib.rs', '#[allow(dead_code)]\n#[allow(unused)]\n#[expect(a)]\n#[expect(b)]\n');
    const higher = run();
    expect(higher.status).toBe(1);
    expect(higher.out).toContain('src/lib.rs');
    expect(run('--prune').status).toBe(1);
    write('src/lib.rs', '');
    write('src/new.ts', '// biome-ignore lint: x\n');
    expect(run().out).toContain('src/new.ts');
  });

  it('fails as stale on a lower count, until pruned', () => {
    run('--init');
    write('src/a.ts', '// eslint-disable-next-line no-console\n');
    const stale = run();
    expect(stale.status).toBe(1);
    expect(stale.out).toContain('src/a.ts');
    expect(run('--prune').status).toBe(0);
    expect(baseline()['src/a.ts']).toBe(1);
    expect(run().status).toBe(0);
  });

  it('skips ESLint where eslint-suppressions.json exists', () => {
    write('eslint-suppressions.json', '{}');
    run('--init');
    expect(baseline()['src/a.ts']).toBeUndefined();
    expect(baseline()['src/b.ts']).toBe(2);
  });
});
