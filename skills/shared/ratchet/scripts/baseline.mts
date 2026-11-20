// Baseline helper of a ratchet: the baseline file holds the grandfathered violations of one rule and
// can only shrink. Entry baseline: sorted violation keys, one per line. Count baseline: JSON object
// key → number. Current violations come from stdin (entry: one key per line; count: `key<TAB>count`
// per line) or from `--current <file>`.
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export type Kind = 'entry' | 'count';
export type Counts = Record<string, number>;
export interface Result {
  ok: boolean;
  added: string[]; // new entry, or a count above the baseline
  stale: string[]; // entry gone, or a count below the baseline
  baseline: string[] | Counts; // what `--prune` writes
}

export function parseCurrent(kind: Kind, text: string): string[] | Counts {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (kind === 'entry') return [...new Set(lines.map((l) => l.trim()))].sort();
  const counts: Counts = {};
  for (const line of lines) {
    const tab = line.lastIndexOf('\t');
    const n = tab < 0 ? NaN : Number(line.slice(tab + 1));
    if (!Number.isInteger(n) || n < 0) throw new Error(`count line needs "key<TAB>count": ${line}`);
    const key = line.slice(0, tab);
    counts[key] = (counts[key] ?? 0) + n;
  }
  return counts;
}

export function serialize(kind: Kind, data: string[] | Counts): string {
  if (kind === 'entry') {
    const list = [...(data as string[])].sort();
    return list.length ? `${list.join('\n')}\n` : '';
  }
  const sorted: Counts = {};
  for (const k of Object.keys(data).sort())
    if ((data as Counts)[k] > 0) sorted[k] = (data as Counts)[k];
  return `${JSON.stringify(sorted, null, 2)}\n`;
}

export function parseBaseline(kind: Kind, text: string): string[] | Counts {
  if (kind === 'entry') return parseCurrent('entry', text);
  const parsed = text.trim() === '' ? {} : JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
    throw new Error('count baseline must be a JSON object');
  return parsed as Counts;
}

export function compare(
  kind: Kind,
  baseline: string[] | Counts,
  current: string[] | Counts,
): Result {
  const added: string[] = [];
  const stale: string[] = [];
  if (kind === 'entry') {
    const base = new Set(baseline as string[]);
    const cur = new Set(current as string[]);
    for (const k of cur) if (!base.has(k)) added.push(k);
    for (const k of base) if (!cur.has(k)) stale.push(k);
    return {
      ok: !added.length && !stale.length,
      added: added.sort(),
      stale: stale.sort(),
      baseline: [...base].filter((k) => cur.has(k)).sort(),
    };
  }
  const base = baseline as Counts;
  const cur = current as Counts;
  const pruned: Counts = {};
  for (const k of Object.keys(cur)) {
    if (cur[k] > (base[k] ?? 0)) added.push(`${k} (${base[k] ?? 0} -> ${cur[k]})`);
  }
  for (const k of Object.keys(base)) {
    const now = cur[k] ?? 0;
    if (now < base[k]) stale.push(`${k} (${base[k]} -> ${now})`);
    if (Math.min(now, base[k]) > 0) pruned[k] = Math.min(now, base[k]);
  }
  return {
    ok: !added.length && !stale.length,
    added: added.sort(),
    stale: stale.sort(),
    baseline: pruned,
  };
}

export function report(r: Result, file: string): string {
  const out: string[] = [];
  if (r.added.length) {
    out.push(`New violations (not in ${file}):`, ...r.added.map((a) => `  + ${a}`));
    out.push(
      'Fix the violation. A new baseline entry or a higher count needs reviewer sign-off: never add one just to get green.',
    );
  }
  if (r.stale.length) {
    out.push(
      `Stale baseline (fixed since ${file} was written):`,
      ...r.stale.map((s) => `  - ${s}`),
    );
    out.push(
      `Lower the baseline in this change: run with --prune to remove stale entries and lower counts.`,
    );
  }
  return out.join('\n');
}

function usage(): string {
  return 'usage: node baseline.mts --baseline <file> --kind entry|count [--current <file>] [--init | --prune]  (current violations on stdin unless --current)';
}

export function main(argv: string[], stdin: () => string): number {
  const opt: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--init' || a === '--prune') opt[a.slice(2)] = true;
    else if (a === '--baseline' || a === '--kind' || a === '--current')
      opt[a.slice(2)] = argv[++i] ?? '';
    else {
      console.error(`unknown argument: ${a}\n${usage()}`);
      return 2;
    }
  }
  const kind = opt.kind as Kind;
  const file = opt.baseline as string;
  if (!file || (kind !== 'entry' && kind !== 'count') || (opt.init && opt.prune)) {
    console.error(usage());
    return 2;
  }
  try {
    const current = parseCurrent(
      kind,
      typeof opt.current === 'string' ? readFileSync(opt.current, 'utf8') : stdin(),
    );
    if (opt.init) {
      writeFileSync(file, serialize(kind, current));
      console.log(`baseline written: ${file}`);
      return 0;
    }
    if (!existsSync(file)) {
      console.error(
        `no baseline ${file}: run with --init to create it from the current violations`,
      );
      return 2;
    }
    const result = compare(kind, parseBaseline(kind, readFileSync(file, 'utf8')), current);
    if (opt.prune) {
      writeFileSync(file, serialize(kind, result.baseline));
      if (result.added.length) {
        console.error(report({ ...result, stale: [] }, file));
        return 1;
      }
      console.log(`baseline pruned: ${file}`);
      return 0;
    }
    if (result.ok) {
      console.log('ratchet ok');
      return 0;
    }
    console.error(report(result, file));
    return 1;
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  process.exitCode = main(process.argv.slice(2), () => readFileSync(0, 'utf8'));
}
