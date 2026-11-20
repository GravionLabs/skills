// Checks every AGENTS.md of a repository: size against the budget, and the reference files under
// docs/agents-md-refs/ (each named by an AGENTS.md with a reading condition, each target present).
// Usage: node check-agents-md.mts [repo] [--budget <n>] [--json]. Exit 1 on any problem, 2 on bad usage.
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_BUDGET = 8000;
const REFS_DIR = 'docs/agents-md-refs';
const REF_RE = /docs\/agents-md-refs\/[^\s`'"()<>[\]]+\.md/g;
const CONDITION_RE = /\bbefore\b.+\bread\b/i;

export interface Problem {
  kind: 'over-budget' | 'unreferenced' | 'no-condition' | 'missing';
  file: string;
  message: string;
}
export interface FileSize {
  path: string;
  characters: number;
  overBudget: boolean;
}
export interface Report {
  root: string;
  budget: number;
  files: FileSize[];
  problems: Problem[];
  ok: boolean;
}

const posix = (p: string): string => p.split(sep).join('/');

function walk(dir: string, visit: (file: string) => void): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(join(dir, entry.name), visit);
    } else if (entry.isFile()) visit(join(dir, entry.name));
  }
}

export function check(root: string, budget = DEFAULT_BUDGET): Report {
  const agents: string[] = [];
  const refFiles: string[] = [];
  walk(root, (f) => {
    const rel = posix(relative(root, f));
    if (f.endsWith(`${sep}AGENTS.md`)) agents.push(rel);
    else if (rel.startsWith(`${REFS_DIR}/`) && rel.endsWith('.md')) refFiles.push(rel);
  });
  agents.sort();
  refFiles.sort();

  const files: FileSize[] = [];
  const problems: Problem[] = [];
  const named = new Set<string>(); // reference files named with a condition by some AGENTS.md
  const mentioned = new Set<string>(); // named at all

  for (const rel of agents) {
    const text = readFileSync(join(root, rel), 'utf8');
    const characters = text.length;
    const overBudget = characters > budget;
    files.push({ path: rel, characters, overBudget });
    if (overBudget)
      problems.push({
        kind: 'over-budget',
        file: rel,
        message: `${rel}: ${characters} / ${budget} characters, ${characters - budget} over; move a section to ${REFS_DIR}/<topic>.md`,
      });

    let fenced = false;
    for (const line of text.split(/\r?\n/)) {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) continue;
      for (const target of new Set(line.match(REF_RE) ?? [])) {
        mentioned.add(target);
        if (!CONDITION_RE.test(line))
          problems.push({
            kind: 'no-condition',
            file: rel,
            message: `${rel}: ${target} is named without a reading condition; write "before <task>, read ${target}"`,
          });
        else named.add(target);
        const exists =
          existsSync(join(root, target)) || existsSync(join(root, dirname(rel), target));
        if (!exists)
          problems.push({
            kind: 'missing',
            file: rel,
            message: `${rel}: ${target} is named but does not exist`,
          });
      }
    }
  }

  for (const ref of refFiles) {
    if (!mentioned.has(ref))
      problems.push({
        kind: 'unreferenced',
        file: ref,
        message: `${ref}: no AGENTS.md names this file; add "before <task>, read ${ref}" or delete it`,
      });
  }

  return { root, budget, files, problems, ok: problems.length === 0 };
}

export function format(report: Report): string {
  const lines = report.files.map((f) => `${f.path}: ${f.characters} / ${report.budget}`);
  for (const p of report.problems) lines.push(`problem [${p.kind}] ${p.message}`);
  if (report.files.length === 0) lines.push('no AGENTS.md found');
  return lines.join('\n');
}

function main(argv: string[]): number {
  let budget = DEFAULT_BUDGET;
  let json = false;
  let repo: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') json = true;
    else if (a === '--budget') {
      budget = Number(argv[++i]);
      if (!Number.isInteger(budget) || budget <= 0) {
        console.error('--budget needs a positive integer');
        return 2;
      }
    } else if (a.startsWith('-')) {
      console.error(`unknown option ${a}`);
      return 2;
    } else repo = a;
  }
  let root: string;
  try {
    root = resolve(
      repo ?? execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim(),
    );
    if (!statSync(root).isDirectory()) throw new Error('not a directory');
  } catch {
    console.error('repository not found: pass a directory or run inside a git repository');
    return 2;
  }
  const report = check(root, budget);
  console.log(json ? JSON.stringify(report, null, 2) : format(report));
  return report.ok ? 0 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode = main(process.argv.slice(2));
