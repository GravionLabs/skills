// AGENTS.md size ratchet: copy to `scripts/ratchets/check-agents-md-size-ratchet.mts`. Counts the characters of every
// AGENTS.md above BUDGET and freezes the existing ones in a count baseline (`path` → characters). A file within the
// budget needs no entry. A higher count fails; a lower count fails as stale until `--prune`. A new file over the budget fails.
// `run-ratchets.mts` (skill `ratchet`) runs it and passes `--init` / `--prune`.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

const BUDGET = 8000;
const BASELINE = path.resolve('scripts/ratchets/baselines/agents-md-size.json');
// Where the ratchet skill's baseline.mts is installed in this repository.
const HELPER = process.env.RATCHET_BASELINE_HELPER ?? path.resolve('.agents/skills/ratchet/scripts/baseline.mts');
const EXCLUDE = /(?:^|\/)(?:node_modules|\.git|dist|build|out|coverage|bin|obj|target|vendor|\.next|\.angular)\//;

function violations(root = '.'): string[] {
  const lines: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = path.posix.join(...path.relative(root, path.join(dir, entry.name)).split(path.sep));
      if (EXCLUDE.test(entry.isDirectory() ? `${rel}/` : rel)) continue;
      if (entry.isDirectory()) walk(path.join(dir, entry.name));
      else if (entry.name === 'AGENTS.md') {
        const characters = readFileSync(path.join(dir, entry.name), 'utf8').length;
        if (characters > BUDGET) lines.push(`${rel}\t${characters}`);
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
