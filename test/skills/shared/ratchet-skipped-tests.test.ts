import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(root, 'skills/shared/ratchet/templates/check-skipped-tests-ratchet.mts');
const HELPER = path.join(root, 'skills/shared/ratchet/scripts/baseline.mts');

describe('ratchet check-skipped-tests-ratchet.mts', () => {
  let tmp: string;
  const write = (rel: string, text: string) => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), text);
  };
  const baseline = () =>
    JSON.parse(
      fs.readFileSync(path.join(tmp, 'scripts/ratchets/baselines/skipped-tests.json'), 'utf8'),
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
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-skip-'));
    write(
      'src/a.test.ts',
      "it.skip('a', f);\ntest.skip('b', f);\ndescribe.skip('c', f);\nxit('d', f);\nxdescribe('e', f);\nit.todo('f');\nit('ok', f);\n",
    );
    write('src/lib.rs', '#[ignore]\n#[test]\nfn a() {}\n#[ignore = "slow"]\n#[test]\nfn b() {}\n');
    write(
      'src/T.cs',
      '[Fact(Skip = "x")]\npublic void A() {}\n[Theory(Skip = "y")]\npublic void B() {}\n[Fact]\npublic void C() {}\n',
    );
    write(
      'src/test_x.py',
      '@pytest.mark.skip(reason="x")\ndef test_a(): pass\n@pytest.mark.skipif(True, reason="y")\ndef test_b(): pass\n@unittest.skip("z")\ndef test_c(): pass\n',
    );
    write('src/clean.test.ts', "it('ok', f);\n");
    write('node_modules/dep/x.test.js', "it.skip('x');\n");
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('counts every form per file, one fixture per language', () => {
    expect(run('--init').status).toBe(0);
    expect(baseline()).toEqual({
      'src/T.cs': 2,
      'src/a.test.ts': 6,
      'src/lib.rs': 2,
      'src/test_x.py': 2,
    });
    expect(run().status).toBe(0);
  });

  it('fails on a higher count and on a new file', () => {
    run('--init');
    write('src/lib.rs', '#[ignore]\n#[ignore]\n#[ignore]\n');
    const higher = run();
    expect(higher.status).toBe(1);
    expect(higher.out).toContain('src/lib.rs');
    expect(run('--prune').status).toBe(1);
    write('src/lib.rs', '');
    write('src/new.test.ts', "it.skip('n');\n");
    expect(run().out).toContain('src/new.test.ts');
  });

  it('fails as stale on a lower count, until pruned', () => {
    run('--init');
    write('src/a.test.ts', "it.skip('a', f);\n");
    const stale = run();
    expect(stale.status).toBe(1);
    expect(stale.out).toContain('src/a.test.ts');
    expect(run('--prune').status).toBe(0);
    expect(baseline()['src/a.test.ts']).toBe(1);
    expect(run().status).toBe(0);
  });
});
