import * as fs from 'fs';
import * as path from 'path';
import { parse } from 'yaml';
import config from '../../vitest.config';

const file = path.resolve(__dirname, '../../.github/workflows/ci.yml');
const wf = parse(fs.readFileSync(file, 'utf-8'));

type Step = { uses?: string; run?: string; with?: Record<string, string> };
const steps = (job: string): Step[] => wf.jobs[job].steps;

describe('ci.yml test job', () => {
  it('runs one Vitest project in a single job without a matrix', () => {
    expect(config.test?.projects).toBeUndefined();
    expect(wf.jobs.test.strategy).toBeUndefined();
    expect(wf.jobs.test.name).toBe('Test');
    expect(wf.on.push.branches).toEqual(['main', 'release/**']);
  });

  it('runs the whole suite with coverage and uploads the results', () => {
    expect(steps('test').some((s) => s.run === 'pnpm run test:ci')).toBe(true);
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));
    expect(pkg.scripts['test:ci']).toBe('vitest run --coverage');
    const artifacts = steps('test').filter((s) => s.uses?.startsWith('actions/upload-artifact'));
    expect(artifacts.length).toBe(2);
  });

  it('tolerates a missing junit.xml and coverage file', () => {
    const reporter = steps('test').find((s) => s.uses?.startsWith('dorny/test-reporter'));
    expect(reporter?.with?.['fail-on-empty']).toBe(false);
    const summary = steps('test').find((s) => s.uses?.startsWith('irongut/CodeCoverageSummary')) as
      | (Step & { if?: string })
      | undefined;
    expect(summary?.if).toContain("hashFiles('coverage/cobertura-coverage.xml') != ''");
    expect((summary as Step & { 'continue-on-error'?: boolean })?.['continue-on-error']).toBe(true);
  });

  it('publishes a report and coverage summary from the vitest outputs', () => {
    const reporter = steps('test').find((s) => s.uses?.startsWith('dorny/test-reporter'));
    expect(reporter?.with?.path).toBe('test-results/junit.xml');
    const summary = steps('test').find((s) => s.uses?.startsWith('irongut/CodeCoverageSummary'));
    expect(summary?.with?.filename).toBe('coverage/cobertura-coverage.xml');
    expect(wf.jobs.test.permissions).toEqual({ checks: 'write', contents: 'read' });
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
      (j as { steps: Step[] }).steps.map((s) => `${s.run ?? ''} ${s.uses ?? ''}`),
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
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));
    const checkCommands = pkg.scripts.check.split(' && ');
    const marketplace = steps('build-test').find((s) => s.run?.includes('check-marketplace.mjs'));
    const report = steps('build-test').find((s) => s.run?.includes('Get-SkillReport.ps1'));
    const formatting = steps('build-test').find((s) => s.run === 'pnpm run format:check');

    expect(checkCommands).toEqual([
      'pnpm run format:check',
      'node scripts/check-marketplace.mjs',
      'pwsh skills/skill-slim/scripts/Get-SkillReport.ps1 -Root . -FailOnDangling',
      'pnpm run lint:ps',
      'pnpm test',
    ]);
    expect(checkCommands).toContain(marketplace?.run);
    expect(checkCommands).toContain(`pwsh ${report?.run?.replace(/^\.\//, '')}`);
    expect(checkCommands).toContain(formatting?.run);

    const analysis = steps('build-test').find((s) => s.run === 'pnpm run lint:ps');
    const analyzerInstall = steps('build-test').find((s) =>
      s.run?.includes('Install-Module PSScriptAnalyzer'),
    );
    expect(checkCommands).toContain(analysis?.run);
    expect(analyzerInstall?.run).toMatch(/-RequiredVersion \d+\.\d+\.\d+/);

    const ciTest = steps('test').find((s) => s.run === 'pnpm run test:ci');
    expect(pkg.scripts['test:ci'].replace(/ --coverage$/, '')).toBe(pkg.scripts.test);
    expect(pkg.scripts.test).toBe('vitest run');
    expect(checkCommands).toContain('pnpm test');
    expect(ciTest?.run).toBe('pnpm run test:ci');
  });
});

describe('ci.yml formatting check and triggers', () => {
  it('runs on pull requests into main and release/next', () => {
    expect(wf.on.pull_request.branches).toEqual(['main', 'release/next']);
  });

  it('runs biome check (format and lint) in CI and biome format --write locally', () => {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../package.json'), 'utf-8'));
    expect(pkg.scripts.format).toBe('biome format --write .');
    expect(pkg.scripts['format:check']).toBe('biome check .');
    expect(steps('build-test').some((s) => s.run === 'pnpm run format:check')).toBe(true);
  });
});
