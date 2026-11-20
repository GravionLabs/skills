import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(root, 'skills/shared/ratchet/templates/check-file-size-ratchet.mts');
const HELPER = path.join(root, 'skills/shared/ratchet/scripts/baseline.mts');

describe('ratchet check-file-size-ratchet.mts', () => {
  let tmp: string;
  const lines = (n: number) => 'x\n'.repeat(n);
  const write = (rel: string, n: number) => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), lines(n));
  };
  const baseline = () => path.join(tmp, 'scripts/ratchets/baselines/file-size.txt');
  const run = (...flags: string[]) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...flags], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, RATCHET_BASELINE_HELPER: HELPER },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-size-'));
    write('src/big.ts', 600);
    write('src/small.ts', 10);
    write('src/edge.ts', 500);
    write('pnpm-lock.yaml', 900);
    write('node_modules/dep/index.js', 900);
    write('src/types.d.ts', 900);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('baselines a file over the limit, skips the limit itself and generated/lock files', () => {
    expect(run('--init').status).toBe(0);
    expect(fs.readFileSync(baseline(), 'utf8')).toBe('src/big.ts:600\n');
    expect(run().status).toBe(0);
  });

  it('fails on a new file over the limit', () => {
    run('--init');
    write('src/new.ts', 501);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toContain('+ src/new.ts:501');
  });

  it('fails as stale when a baselined file shrank, until pruned', () => {
    run('--init');
    write('src/big.ts', 550);
    expect(run().status).toBe(1);
    write('src/big.ts', 100);
    const stale = run();
    expect(stale.status).toBe(1);
    expect(stale.out).toContain('- src/big.ts:600');
    expect(run('--prune').status).toBe(0);
    expect(fs.readFileSync(baseline(), 'utf8')).toBe('');
    expect(run().status).toBe(0);
  });
});
