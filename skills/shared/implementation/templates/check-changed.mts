// The gate `check:changed` (references/gate.md): copy to `scripts/check-changed.mts` and wire it as
// the package script `"check:changed": "node scripts/check-changed.mts"` (Node >= 22.18, no build).
// Steps on the changed files (diff against the merge-base with the base, plus untracked files):
// format check, lint, typecheck, related tests, then every `checks` entry of `.agents/config.json`.
// Success prints one line; a failed step prints its full output (only that step) and the exit is 1.
// Usage: node scripts/check-changed.mts [--base=<ref>]   (GATE_MAX_WORKERS limits the test workers)
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { availableParallelism } from 'node:os';
import * as path from 'node:path';

interface Step {
  name: string;
  run: () => { status: number | null; output: string } | undefined; // undefined: step not applicable
}

const git = (...args: string[]) => {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
};
const lines = (s: string) => s.split('\n').filter(Boolean);

function baseRef(argv: string[]): string {
  const flag = argv.find((a) => a.startsWith('--base='));
  if (flag) return flag.slice('--base='.length);
  for (const ref of ['origin/main', 'origin/master', 'main', 'master'])
    if (git('rev-parse', '--verify', '--quiet', ref).ok) return ref;
  throw new Error('no base branch found; pass --base=<ref>');
}

export function changedFiles(base: string): string[] {
  const mb = git('merge-base', base, 'HEAD');
  if (!mb.ok) throw new Error(`git merge-base ${base} HEAD failed: ${mb.err}`);
  const diff = git('diff', '--name-only', '--diff-filter=d', mb.out);
  const untracked = git('ls-files', '--others', '--exclude-standard');
  if (!diff.ok || !untracked.ok) throw new Error(`git failed: ${diff.err || untracked.err}`);
  return [...new Set([...lines(diff.out), ...lines(untracked.out)])].filter((f) => existsSync(f));
}

export function workers(env = process.env): number {
  const n = Number(env.GATE_MAX_WORKERS);
  if (Number.isInteger(n) && n >= 1) return n;
  return Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
}

const bin = (tool: string) => {
  const dir = path.resolve('node_modules/.bin');
  return ['', '.cmd'].some((e) => existsSync(path.join(dir, tool + e))) ? tool : undefined;
};
const tool = (...names: string[]) => names.find((n) => bin(n));

function exec(cmd: string, args: string[]) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: process.platform === 'win32',
    env: { ...process.env, PATH: `${path.resolve('node_modules/.bin')}${path.delimiter}${process.env.PATH}` },
  });
  const output = `${r.stdout ?? ''}${r.stderr ?? ''}${r.error ? `${r.error.message}\n` : ''}`;
  return { status: r.error ? 1 : r.status, output };
}

const ext = (files: string[], re: RegExp) => files.filter((f) => re.test(f));
const FORMAT = /\.(m?[jt]sx?|cjs|cts|json|jsonc|css|scss|html|md|ya?ml)$/;
const LINT = /\.(m?[jt]sx?|cjs|cts)$/;

export function steps(files: string[]): Step[] {
  const out: Step[] = [];
  const fmtFiles = ext(files, FORMAT);
  const lintFiles = ext(files, LINT);
  out.push({
    name: 'format',
    run: () => {
      if (!fmtFiles.length) return undefined;
      const t = tool('oxfmt', 'biome', 'prettier');
      if (t === 'oxfmt') return exec(t, ['--check', '--no-error-on-unmatched-pattern', ...fmtFiles]);
      if (t === 'biome') return exec(t, ['format', '--no-errors-on-unmatched', ...fmtFiles]);
      if (t === 'prettier') return exec(t, ['--check', '--ignore-unknown', ...fmtFiles]);
      return undefined;
    },
  });
  out.push({
    name: 'lint',
    run: () => {
      if (!lintFiles.length) return undefined;
      const t = tool('oxlint', 'biome', 'eslint');
      if (t === 'oxlint') return exec(t, ['--no-error-on-unmatched-pattern', ...lintFiles]);
      if (t === 'biome') return exec(t, ['lint', '--no-errors-on-unmatched', ...lintFiles]);
      if (t === 'eslint') return exec(t, ['--no-warn-ignored', ...lintFiles]);
      return undefined;
    },
  });
  out.push({
    name: 'typecheck',
    run: () => {
      if (!lintFiles.length || !existsSync('tsconfig.json') || !bin('tsc')) return undefined;
      return exec('tsc', ['--noEmit']);
    },
  });
  out.push({
    name: 'tests',
    run: () => {
      if (!lintFiles.length) return undefined;
      const n = String(workers());
      if (bin('vitest')) return exec('vitest', ['related', '--run', `--maxWorkers=${n}`, ...lintFiles]);
      if (bin('jest'))
        return exec('jest', ['--findRelatedTests', `--maxWorkers=${n}`, '--passWithNoTests', ...lintFiles]);
      return undefined;
    },
  });
  return out;
}

export function configChecks(): { name: string; command: string[] }[] {
  const file = path.resolve('.agents/config.json');
  if (!existsSync(file)) return [];
  const cfg = JSON.parse(readFileSync(file, 'utf8')) as {
    checks?: { name?: string; command: string | string[] }[];
  };
  return (cfg.checks ?? []).map((c) => ({
    name: c.name ?? String(Array.isArray(c.command) ? c.command[0] : c.command),
    command: Array.isArray(c.command) ? c.command : [c.command],
  }));
}

function main(): number {
  let files: string[];
  try {
    files = changedFiles(baseRef(process.argv.slice(2)));
  } catch (e) {
    console.error(`check-changed: ${(e as Error).message}`);
    return 2;
  }
  const failed: string[] = [];
  const report = (name: string, r: { status: number | null; output: string } | undefined) => {
    if (!r || r.status === 0) return;
    failed.push(name);
    console.log(`=== check:changed ${name}: FAILED (exit ${r.status}) ===\n${r.output.replace(/\s+$/, '')}`);
  };
  for (const s of steps(files)) report(s.name, s.run());
  try {
    for (const c of configChecks()) {
      for (const cmd of c.command) {
        const r = spawnSync(cmd, { shell: true, encoding: 'utf8' });
        report(`check ${c.name}`, { status: r.status ?? 1, output: `${r.stdout ?? ''}${r.stderr ?? ''}` });
      }
    }
  } catch (e) {
    console.error(`check-changed: .agents/config.json: ${(e as Error).message}`);
    return 2;
  }
  if (failed.length) {
    console.log(`check:changed failed: ${failed.join(', ')}`);
    return 1;
  }
  console.log(`check:changed: ok (${files.length} changed file${files.length === 1 ? '' : 's'})`);
  return 0;
}

process.exitCode = main();
