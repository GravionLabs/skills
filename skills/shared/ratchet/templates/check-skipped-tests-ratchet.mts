// Skipped-tests ratchet: copy to `scripts/ratchets/check-skipped-tests-ratchet.mts`. Counts, per file, every
// test that is switched off and freezes the existing ones in a count baseline (`path` → number): a test that
// stays skipped hides a defect. A higher count fails; a lower count fails as stale until `--prune`.
// Forms: it.skip, test.skip, describe.skip, xit, xdescribe, it.todo, Rust #[ignore], .NET [Fact(Skip / [Theory(Skip,
// Python @pytest.mark.skip and @unittest.skip. `run-ratchets.mts` runs it and passes `--init` / `--prune`.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

const BASELINE = path.resolve('scripts/ratchets/baselines/skipped-tests.json');
// Where the ratchet skill's baseline.mts is installed in this repository.
const HELPER = process.env.RATCHET_BASELINE_HELPER ?? path.resolve('.agents/skills/ratchet/scripts/baseline.mts');
const SOURCE = /\.(?:[cm]?[jt]sx?|rs|cs|py)$/;
const EXCLUDE = /(?:^|\/)(?:node_modules|\.git|dist|build|out|coverage|bin|obj|target|vendor|\.next|\.angular)\//;

const FORMS: RegExp[] = [
  /\b(?:it|test|describe)\.skip\b/g,
  /\b(?:xit|xdescribe)\s*\(/g,
  /\bit\.todo\b/g,
  /#\[\s*ignore\b/g, // Rust, with or without a reason
  /\[\s*(?:Fact|Theory)\s*\([^\]]*\bSkip\s*=/g, // .NET xUnit
  /@pytest\.mark\.skip\b(?!if)/g,
  /@unittest\.skip(?:If|Unless)?\b/g,
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
