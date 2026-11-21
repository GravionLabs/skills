// Job-timeout ratchet: copy to `scripts/ratchets/check-job-timeout-ratchet.mts`. Lists every job of
// `.github/workflows/*.yml` and `*.yaml` without `timeout-minutes` as `<workflow file>#<job id>` in an entry
// baseline. A job that calls a reusable workflow (`uses:`) is exempt: the timeout is set inside it.
// A new job without a timeout fails; a baselined job that got one fails as stale until `--prune`.
// No YAML library: the jobs are read by indentation (job ids under `jobs:`, keys one level deeper).
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

const BASELINE = path.resolve('scripts/ratchets/baselines/job-timeout.txt');
// Where the ratchet skill's baseline.mts is installed in this repository.
const HELPER = process.env.RATCHET_BASELINE_HELPER ?? path.resolve('.agents/skills/ratchet/scripts/baseline.mts');
const WORKFLOWS = '.github/workflows';

const indentOf = (line: string): number => line.length - line.trimStart().length;
const isBlank = (line: string): boolean => /^\s*(?:#.*)?$/.test(line);

// Jobs of one workflow text that have neither `timeout-minutes` nor `uses` as a key of the job.
function jobsWithoutTimeout(text: string): string[] {
  const lines = text.replace(/\r/g, '').split('\n');
  const start = lines.findIndex((l) => /^jobs:\s*(?:#.*)?$/.test(l));
  if (start < 0) return [];
  const jobs: { id: string; keys: Set<string> }[] = [];
  let jobIndent = -1;
  let keyIndent = -1;
  for (const line of lines.slice(start + 1)) {
    if (isBlank(line)) continue;
    const indent = indentOf(line);
    if (indent === 0) break; // next top-level key
    if (jobIndent < 0) jobIndent = indent;
    if (indent === jobIndent) {
      const m = /^\s*(?:"([^"]+)"|'([^']+)'|([^\s:#"']+))\s*:/.exec(line);
      if (m) jobs.push({ id: m[1] ?? m[2] ?? m[3], keys: new Set() });
    } else if (indent > jobIndent && jobs.length > 0) {
      if (keyIndent < 0 || keyIndent <= jobIndent) keyIndent = indent;
      if (indent === keyIndent) {
        const k = /^\s*([\w-]+)\s*:/.exec(line);
        if (k) jobs[jobs.length - 1].keys.add(k[1]);
      }
    }
  }
  return jobs.filter((j) => !j.keys.has('timeout-minutes') && !j.keys.has('uses')).map((j) => j.id);
}

function violations(): string[] {
  if (!existsSync(WORKFLOWS)) return [];
  const keys: string[] = [];
  for (const name of readdirSync(WORKFLOWS).sort()) {
    if (!/\.ya?ml$/.test(name)) continue;
    for (const id of jobsWithoutTimeout(readFileSync(path.join(WORKFLOWS, name), 'utf8'))) {
      keys.push(`${name}#${id}`);
    }
  }
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
