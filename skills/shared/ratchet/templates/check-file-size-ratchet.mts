// File-size ratchet: copy to `scripts/ratchets/check-file-size-ratchet.mts`. Counts the lines of every
// source file above MAX_LINES and freezes the existing ones in an entry baseline (`path:lines`).
// A new file above the limit fails; a baselined file that got shorter (or longer) fails as stale
// until `--prune`. `run-ratchets.mts` runs it and passes `--init` / `--prune`.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

const MAX_LINES = 500;
const BASELINE = path.resolve('scripts/ratchets/baselines/file-size.txt');
// Where the ratchet skill's baseline.mts is installed in this repository.
const HELPER = process.env.RATCHET_BASELINE_HELPER ?? path.resolve('.agents/skills/ratchet/scripts/baseline.mts');
const SOURCE = /\.(?:[cm]?[jt]sx?|py|cs|go|rs|java|kt|swift|rb|php|cpp|cc|c|h|hpp|ps1|psm1|sh|vue|svelte|scss|css)$/;
// Directories and generated/lock files (matched against the path relative to the root) are skipped.
const EXCLUDE = [
  /(?:^|\/)(?:node_modules|\.git|dist|build|out|coverage|bin|obj|target|vendor|\.next|\.angular)\//,
  /(?:^|\/)(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum|poetry\.lock|uv\.lock)$/,
  /\.(?:min\.[cm]?js|lock|generated\.\w+|g\.cs|designer\.cs|d\.ts)$/i,
];

function lineCount(text: string): number {
  if (text === '') return 0;
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
}

function violations(root = '.'): string[] {
  const keys: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = path.posix.join(...path.relative(root, path.join(dir, entry.name)).split(path.sep));
      if (EXCLUDE.some((re) => re.test(entry.isDirectory() ? `${rel}/` : rel))) continue;
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (SOURCE.test(entry.name)) {
        const lines = lineCount(readFileSync(path.join(dir, entry.name), 'utf8'));
        if (lines > MAX_LINES) keys.push(`${rel}:${lines}`);
      }
    }
  };
  walk(root);
  return keys;
}

const flags = process.argv.slice(2); // --init or --prune from the runner
mkdirSync(path.dirname(BASELINE), { recursive: true });
const r = spawnSync(process.execPath, [HELPER, '--baseline', BASELINE, '--kind', 'entry', ...flags], {
  input: violations().join('\n'),
  encoding: 'utf8',
});
process.stdout.write(r.stdout ?? '');
process.stderr.write(r.stderr ?? '');
process.exit(r.status ?? 2);
