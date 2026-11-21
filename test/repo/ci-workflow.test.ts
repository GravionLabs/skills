import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import config from '../../vitest.config';

const file = path.resolve(__dirname, '../../.github/workflows/ci.yml');
const wf = parse(fs.readFileSync(file, 'utf-8'));

type Step = {
  name?: string;
  uses?: string;
  run?: string;
  if?: string;
  env?: Record<string, string>;
  with?: Record<string, string>;
};
const steps = (job: string): Step[] => wf.jobs[job].steps ?? [];
const pkgJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));

describe('ci.yml test jobs', () => {
  it('runs one Vitest project as four shards, with an aggregate check named Test', () => {
    expect(config.test?.projects).toBeUndefined();
    expect(wf.jobs['test-shard'].strategy.matrix.shard).toEqual([1, 2, 3, 4]);
    expect(wf.jobs['test-shard'].name).toBe('Test (${{ matrix.shard }}/4)');
    expect(wf.jobs.test.strategy).toBeUndefined();
    expect(wf.jobs.test.name).toBe('Test');
    expect(wf.on.push.branches).toEqual(['main', 'release/**']);
  });

  it('runs each shard with vitest --shard and its own junit file', () => {
    const run = steps('test-shard').find((s) => s.run?.includes('vitest run'));
    expect(run?.run).toBe('pnpm exec vitest run --shard=${{ matrix.shard }}/4');
    expect(run?.env?.['VITEST_JUNIT_OUTPUT']).toBe('test-results/junit-${{ matrix.shard }}.xml');
  });

  it('uploads each shard junit as test-results-<i>', () => {
    const artifacts = steps('test-shard').filter((s) =>
      s.uses?.startsWith('actions/upload-artifact'),
    );
    expect(artifacts.length).toBe(1);
    expect(artifacts[0]?.with?.['name']).toBe('test-results-${{ matrix.shard }}');
    expect(artifacts[0]?.with?.['path']).toBe('test-results/');
  });

  it('has no coverage in CI: no flag, no coverage upload, no coverage summary, no dorny reporter', () => {
    expect(pkgJson.scripts['test:ci']).toBe('vitest run');
    expect(JSON.stringify(wf)).not.toMatch(/coverage|dorny|--coverage/i);
  });

  it('keeps the aggregate Test green only when all four shards succeeded', () => {
    expect(wf.jobs.test.needs).toBe('test-shard');
    expect(wf.jobs.test.if).toBe('always()');
    const check = steps('test').find((s) => s.run?.includes('exit 1'));
    expect(check?.env?.['RESULT']).toBe('${{ needs.test-shard.result }}');
    expect(check?.run).toContain('"$RESULT" != "success"');
    expect(check?.run).not.toContain('skipped');
  });

  it('does not use the fixed-name node/test action in any job', () => {
    for (const job of Object.keys(wf.jobs)) {
      for (const s of steps(job)) expect(s.uses ?? '').not.toContain('node/test@');
    }
    expect(steps('build-test').some((s) => s.run?.includes('vitest'))).toBe(false);
  });

  it('makes the release wait for the test jobs and build-test', () => {
    expect(wf.jobs.release.needs).toEqual(expect.arrayContaining(['test', 'build-test']));
  });

  it('commits nothing back: no regenerate job, no git push, no apm', () => {
    expect(wf.jobs['regenerate-and-commit']).toBeUndefined();
    expect(wf.jobs['lint-no-generated-files']).toBeUndefined();
    const runs = Object.values(wf.jobs).flatMap((j) =>
      ((j as { steps?: Step[] }).steps ?? []).map((s) => `${s.run ?? ''} ${s.uses ?? ''}`),
    );
    for (const r of runs) expect(r).not.toMatch(/git push|apm /);
  });
});

describe('ci.yml checks', () => {
  it('runs marketplace check and skill report once, in build-test', () => {
    const runs = steps('build-test').map((s) => s.run ?? '');
    expect(runs.filter((r) => r.includes('check-marketplace.mjs')).length).toBe(1);
    expect(runs.filter((r) => r.includes('Get-SkillReport.ps1')).length).toBe(1);
    expect(JSON.stringify(wf)).not.toContain('integration');
  });

  it('includes every CI check in the local check script', () => {
    const checkCommands = pkgJson.scripts.check.split(' && ');
    const marketplace = steps('build-test').find((s) => s.run?.includes('check-marketplace.mjs'));
    const report = steps('build-test').find((s) => s.run?.includes('Get-SkillReport.ps1'));
    const formatting = steps('build-test').find((s) => s.run === 'pnpm run format:check');

    expect(checkCommands).toEqual([
      'pnpm run format:check',
      'node scripts/check-marketplace.mjs',
      'pwsh skills/skill-tooling/skill-slim/scripts/Get-SkillReport.ps1 -Root . -FailOnDangling',
      'pnpm run lint:ps',
      'pnpm run typecheck',
      'pnpm test',
    ]);
    expect(checkCommands).toContain(marketplace?.run);
    expect(checkCommands).toContain(`pwsh ${report?.run?.replace(/^\.\//, '')}`);
    expect(checkCommands).toContain(formatting?.run);

    const typecheck = steps('build-test').find((s) => s.run === 'pnpm run typecheck');
    expect(checkCommands).toContain(typecheck?.run);

    const analysis = steps('build-test').find((s) => s.run === 'pnpm run lint:ps');
    const analyzerInstall = steps('build-test').find((s) =>
      s.run?.includes('Install-Module PSScriptAnalyzer'),
    );
    expect(checkCommands).toContain(analysis?.run);
    expect(analyzerInstall?.run).toMatch(/-RequiredVersion \d+\.\d+\.\d+/);

    const shardRun = steps('test-shard').find((s) => s.run?.includes('vitest run'));
    expect(pkgJson.scripts['test:ci']).toBe(pkgJson.scripts.test);
    expect(pkgJson.scripts.test).toBe('vitest run');
    expect(checkCommands).toContain('pnpm test');
    expect(shardRun?.run).toContain('vitest run');
  });
});

describe('ci.yml formatting check and triggers', () => {
  it('runs on pull requests into main and release/**', () => {
    expect(wf.on.pull_request.branches).toEqual(['main', 'release/**']);
  });

  it('runs the oxfmt check and oxlint in CI and oxfmt locally (ADR 0006)', () => {
    expect(pkgJson.scripts.format).toBe('oxfmt');
    expect(pkgJson.scripts['format:check']).toBe('oxfmt --check && oxlint');
    expect(steps('build-test').some((s) => s.run === 'pnpm run format:check')).toBe(true);
  });
});

// #836: one aggregate job is the only required check, so jobs can change without a ruleset change.
describe('ci.yml aggregate required check', () => {
  const aggregate = wf.jobs['pr-checks-passed'];

  it('has the job PR checks passed, which runs always and needs every other job', () => {
    expect(aggregate.name).toBe('PR checks passed');
    expect(aggregate.if).toBe('always()');
    const others = Object.keys(wf.jobs).filter((j) => j !== 'pr-checks-passed');
    expect([...aggregate.needs].sort()).toEqual([...others].sort());
    expect(Object.keys(wf.jobs).at(-1)).toBe('pr-checks-passed');
  });

  it('fails when a needed job failed or was cancelled and accepts skipped', () => {
    const check = steps('pr-checks-passed').find((s) => s.run?.includes('exit 1'));
    expect(check?.env?.['NEEDS']).toBe('${{ toJSON(needs) }}');
    expect(check?.run).toContain('.result == "success" or .result == "skipped"');
  });

  it('names the required check in a comment above the jobs', () => {
    const text = fs.readFileSync(file, 'utf-8');
    expect(text.indexOf('"PR checks passed"')).toBeLessThan(text.indexOf('\njobs:'));
  });

  // #898: a skipped code check would let the aggregate of an edited or labeled event go green before the tests finish.
  it('runs build and test jobs for every pull request event type', () => {
    for (const job of ['build-test', 'test-shard', 'test-windows']) {
      expect(wf.jobs[job].if).toBeUndefined();
    }
  });
});
