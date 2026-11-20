import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(root, 'skills/shared/ratchet/templates/check-job-timeout-ratchet.mts');
const HELPER = path.join(root, 'skills/shared/ratchet/scripts/baseline.mts');

describe('ratchet check-job-timeout-ratchet.mts', () => {
  let tmp: string;
  const wf = (name: string, text: string) => {
    fs.mkdirSync(path.join(tmp, '.github/workflows'), { recursive: true });
    fs.writeFileSync(path.join(tmp, '.github/workflows', name), text);
  };
  const baseline = () => path.join(tmp, 'scripts/ratchets/baselines/job-timeout.txt');
  const run = (...flags: string[]) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...flags], {
      cwd: tmp,
      encoding: 'utf8',
      env: { ...process.env, RATCHET_BASELINE_HELPER: HELPER },
    });
    return { status: r.status, out: r.stdout + r.stderr };
  };
  const CI = `name: ci
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: |
          echo "timeout-minutes: 5"
  lint:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - run: echo
  call:
    uses: org/repo/.github/workflows/x.yml@v1
`;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ratchet-timeout-'));
    wf('ci.yml', CI);
  });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('baselines only the job without timeout; a job with one and a uses: job are ignored', () => {
    expect(run('--init').status).toBe(0);
    expect(fs.readFileSync(baseline(), 'utf8')).toBe('ci.yml#build\n');
    expect(run().status).toBe(0);
  });

  it('fails on a new job without timeout-minutes', () => {
    run('--init');
    wf('new.yaml', 'on: push\njobs:\n  deploy:\n    runs-on: ubuntu-latest\n    steps: []\n');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toContain('+ new.yaml#deploy');
  });

  it('passes a new job that has a timeout', () => {
    run('--init');
    wf('new.yml', 'jobs:\n  ok:\n    timeout-minutes: 5\n    runs-on: x\n');
    expect(run().status).toBe(0);
  });

  it('fails as stale when a baselined job got a timeout, until pruned', () => {
    run('--init');
    wf(
      'ci.yml',
      CI.replace(
        '  build:\n    runs-on: ubuntu-latest\n',
        '  build:\n    runs-on: ubuntu-latest\n    timeout-minutes: 15\n',
      ),
    );
    const stale = run();
    expect(stale.status).toBe(1);
    expect(stale.out).toContain('- ci.yml#build');
    expect(run('--prune').status).toBe(0);
    expect(run().status).toBe(0);
  });

  it('handles a repository without workflows', () => {
    fs.rmSync(path.join(tmp, '.github'), { recursive: true });
    expect(run('--init').status).toBe(0);
    expect(run().status).toBe(0);
  });
});
