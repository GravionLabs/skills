// Runs the ratchet scripts of a repository: every `check-*-ratchet.mts` of a directory, in parallel
// with a worker limit. The output of one script is printed as one block (no interleaving). Exit 1
// when any script fails, 2 on a usage error.
// Usage: node run-ratchets.mts [--dir scripts/ratchets] [--only <name>] [--workers <n>] [--init | --prune]
import { spawn } from 'node:child_process';
import { existsSync, readdirSync, realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { availableParallelism } from 'node:os';
import * as path from 'node:path';

const PATTERN = /^check-(.+)-ratchet\.mts$/;

interface Options {
  dir: string;
  only?: string;
  workers: number;
  pass: string[];
}

interface Outcome {
  name: string;
  code: number;
  output: string;
}

export function parseArgs(argv: string[]): Options {
  const o: Options = {
    dir: 'scripts/ratchets',
    workers: Math.max(1, Math.min(4, availableParallelism())),
    pass: [],
  };
  const value = (i: number, flag: string) => {
    if (i + 1 >= argv.length) throw new Error(`${flag} needs a value`);
    return argv[i + 1];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') o.dir = value(i++, a);
    else if (a === '--only') o.only = value(i++, a);
    else if (a === '--workers') {
      const n = Number(value(i++, a));
      if (!Number.isInteger(n) || n < 1) throw new Error('--workers needs a positive integer');
      o.workers = n;
    } else if (a === '--init' || a === '--prune') {
      if (!o.pass.includes(a)) o.pass.push(a);
    } else throw new Error(`unknown argument: ${a}`);
  }
  if (o.pass.length > 1) throw new Error('--init and --prune cannot be combined');
  return o;
}

export function discover(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => PATTERN.test(f))
    .sort();
}

function runOne(dir: string, file: string, pass: string[]): Promise<Outcome> {
  const name = file.match(PATTERN)![1];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(dir, file), ...pass], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    child.on('error', (e) => resolve({ name, code: 1, output: `${output}${e.message}\n` }));
    child.on('close', (code) => resolve({ name, code: code ?? 1, output }));
  });
}

function block(o: Outcome): string {
  const body = o.output.replace(/\s+$/, '');
  return `=== ratchet ${o.name}: ${o.code === 0 ? 'ok' : `FAILED (exit ${o.code})`} ===\n${body ? `${body}\n` : ''}`;
}

async function main(): Promise<number> {
  let opts: Options;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`run-ratchets: ${(e as Error).message}`);
    return 2;
  }
  const dir = path.resolve(opts.dir);
  if (!existsSync(dir)) {
    console.error(`run-ratchets: directory not found: ${opts.dir}`);
    return 2;
  }
  let files = discover(dir);
  if (opts.only) {
    const want = opts.only.replace(/^check-/, '').replace(/-ratchet(\.mts)?$/, '');
    files = files.filter((f) => f.match(PATTERN)![1] === want);
    if (!files.length) {
      console.error(`run-ratchets: no ratchet named "${opts.only}" in ${opts.dir}`);
      return 2;
    }
  }
  if (!files.length) {
    console.error(`run-ratchets: no check-*-ratchet.mts in ${opts.dir}`);
    return 2;
  }

  const queue = [...files];
  const results: Outcome[] = [];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const o = await runOne(dir, f, opts.pass);
      results.push(o);
      process.stdout.write(`${block(o)}\n`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(opts.workers, files.length) }, worker));

  const failed = results.filter((r) => r.code !== 0).map((r) => r.name);
  console.log(`${results.length - failed.length}/${results.length} ratchets passed`);
  if (failed.length) {
    console.log(`Failed: ${failed.sort().join(', ')}. Each block above names the fix.`);
    return 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href)
  process.exitCode = await main();
