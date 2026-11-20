// Lint-suppression ratchet: copy to `scripts/ratchets/check-lint-suppressions-ratchet.mts`. Counts, per file,
// every comment or attribute that switches a lint rule off and freezes the existing ones in a count baseline
// (`path` → number). A higher count fails; a lower count fails as stale until `--prune`.
// Forms: eslint-disable, oxlint-disable, biome-ignore, Rust #[allow( and #[expect(, C# #pragma warning disable.
// ESLint is skipped where ESLint bulk suppressions exist (`eslint-suppressions.json`): that file is the native baseline.
// `run-ratchets.mts` runs it and passes `--init` / `--prune`.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

const BASELINE = path.resolve('scripts/ratchets/baselines/lint-suppressions.json');
// Where the ratchet skill's baseline.mts is installed in this repository.
const HELPER = process.env.RATCHET_BASELINE_HELPER ?? path.resolve('.agents/skills/ratchet/scripts/baseline.mts');
const SOURCE = /\.(?:[cm]?[jt]sx?|vue|svelte|rs|cs)$/;
const EXCLUDE = /(?:^|\/)(?:node_modules|\.git|dist|build|out|coverage|bin|obj|target|vendor|\.next|\.angular)\//;
const ESLINT_BULK = existsSync('eslint-suppressions.json');

const FORMS: RegExp[] = [
  ...(ESLINT_BULK ? [] : [/\beslint-disable(?:-next-line|-line)?\b/g]),
  /\boxlint-disable(?:-next-line|-line)?\b/g,
  /\bbiome-ignore\b/g,
  /#!?\[\s*(?:allow|expect)\s*\(/g, // Rust, outer and inner attributes
  /^[ \t]*#pragma\s+warning\s+disable\b/gm, // C#
];

function count(text: string): number {
  return FORMS.reduce((sum, re) => sum + (text.match(re)?.length ?? 0), 0);
}

function violations(root = '.'): string[] {
  const lines: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = path.posix.join(...path.relative(root, path.join(dir, entry.name)).split(path.sep));
      if (EXCLUDE.test(entry.isDirectory() ? `${rel}/` : rel)) continue;
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (SOURCE.test(entry.name)) {
        const n = count(readFileSync(path.join(dir, entry.name), 'utf8'));
        if (n > 0) lines.push(`${rel}\t${n}`);
      }
    }
  };
  walk(root);
  return lines;
}

const flags = process.argv.slice(2); // --init or --prune from the runner
mkdirSync(path.dirname(BASELINE), { recursive: true });
const r = spawnSync(process.execPath, [HELPER, '--baseline', BASELINE, '--kind', 'count', ...flags], {
  input: violations().join('\n'),
  encoding: 'utf8',
});
process.stdout.write(r.stdout ?? '');
process.stderr.write(r.stderr ?? '');
process.exit(r.status ?? 2);
