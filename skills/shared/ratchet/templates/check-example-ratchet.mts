// Template of a ratchet script: copy to `scripts/ratchets/check-<rule>-ratchet.mts`, adapt RULE,
// BASELINE, HELPER and violations(). `run-ratchets.mts` runs it and passes `--init` / `--prune`.
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import * as path from 'node:path';

const RULE = 'no-todo'; // what this ratchet counts
const BASELINE = path.resolve('scripts/ratchets/baselines/no-todo.txt');
// Where the ratchet skill's baseline.mts is installed in this repository.
const HELPER = path.resolve('.agents/skills/ratchet/scripts/baseline.mts');

// Entry kind: one key per violation, without line numbers (`path:rule`).
function violations(dir = 'src'): string[] {
  const keys: string[] = [];
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) keys.push(...violations(file));
    else if (/TODO/.test(readFileSync(file, 'utf8'))) keys.push(`${file}:${RULE}`);
  }
  return keys;
}

const flags = process.argv.slice(2); // --init or --prune from the runner
const r = spawnSync(process.execPath, [HELPER, '--baseline', BASELINE, '--kind', 'entry', ...flags], {
  input: violations().join('\n'),
  encoding: 'utf8',
});
process.stdout.write(r.stdout ?? '');
process.stderr.write(r.stderr ?? '');
process.exit(r.status ?? 2);
