import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(
  root,
  'skills/shared/agents-md/templates/check-agents-md-size-ratchet.mts',
);
const HELPER = path.join(root, 'skills/shared/ratchet/scripts/baseline.mts');

describe('agents-md check-agents-md-size-ratchet.mts', () => {
  let tmp: string;
  const write = (rel: string, n: number) => {
    fs.mkdirSync(path.dirname(path.join(tmp, rel)), { recursive: true });
    fs.writeFileSync(path.join(tmp, rel), 'x'.repeat(n));
  };
  const baseline = () => path.join(tmp, 'scripts/ratchets/baselines/agents-md-size.json');
  const run = (...flags: string[]) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...flags], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, RATCHET_BASELINE_HELPER: HELPER },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-agents-md-'));
    write('AGENTS.md', 9000);
    write('pkg/AGENTS.md', 8000);
    write('node_modules/dep/AGENTS.md', 20000);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('baselines only a file over the budget', () => {
    expect(run('--init').status).toBe(0);
    expect(JSON.parse(fs.readFileSync(baseline(), 'utf8'))).toEqual({ 'AGENTS.md': 9000 });
    expect(run().status).toBe(0);
  });

  it('fails for a grown file and for a new file over the budget', () => {
    run('--init');
    write('AGENTS.md', 9100);
    expect(run().status).toBe(1);
    write('AGENTS.md', 9000);
    write('pkg/AGENTS.md', 8001);
    expect(run().status).toBe(1);
  });

  it('fails as stale when a file shrank, until pruned, and needs no entry within the budget', () => {
    run('--init');
    write('AGENTS.md', 7000);
    expect(run().status).toBe(1);
    expect(run('--prune').status).toBe(0);
    expect(JSON.parse(fs.readFileSync(baseline(), 'utf8'))).toEqual({});
    expect(run().status).toBe(0);
  });
});
