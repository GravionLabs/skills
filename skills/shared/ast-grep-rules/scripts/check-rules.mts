// Checks the ast-grep rules of a repository: every rule has a message with a reason ("Why:"), a
// replacement ("Instead:") and the issue or PR that caused it ("See #123"), and a rule test of the
// same id. Usage: node check-rules.mts [--config <sgconfig.yml>] [--allow-placeholder]
// (default config: sgconfig.yml). --allow-placeholder accepts "See #<nr>" and is for the templates only.
// Exit 0 ok, 1 violations, 2 usage error. Node >= 22.18 (erasable TypeScript, no dependencies).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export interface Rule {
  id: string;
  message: string;
  file: string;
}

const unquote = (s: string): string => {
  const t = s.trim();
  return /^(['"]).*\1$/s.test(t) ? t.slice(1, -1) : t;
};

// Top-level scalar `key` of one YAML document (plain, quoted, folded `>` or literal `|`).
function scalar(doc: string[], key: string): string | undefined {
  const i = doc.findIndex((l) => l.startsWith(`${key}:`));
  if (i < 0) return undefined;
  const head = doc[i].slice(key.length + 1).trim();
  const parts: string[] = [];
  for (let j = i + 1; j < doc.length && (doc[j].trim() === '' || /^\s/.test(doc[j])); j++)
    parts.push(doc[j].trim());
  if (/^[|>][+-]?$/.test(head)) return parts.join(' ').trim();
  return unquote([head, ...parts].join(' ').trim());
}

export function parseDocs(text: string): { id?: string; message?: string }[] {
  const docs: string[][] = [[]];
  for (const line of text.split(/\r?\n/)) {
    if (/^---\s*$/.test(line)) docs.push([]);
    else docs.at(-1)!.push(line);
  }
  return docs.map((d) => ({ id: scalar(d, 'id'), message: scalar(d, 'message') }));
}

function yamlFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...yamlFiles(p));
    else if (/\.ya?ml$/.test(name)) out.push(p);
  }
  return out;
}

function listAfter(text: string, key: string): string[] {
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(`${key}:`));
  if (i < 0) return [];
  const inline = lines[i].match(/\[(.*)\]/);
  if (inline) return inline[1].split(',').map(unquote).filter(Boolean);
  const out: string[] = [];
  for (let j = i + 1; j < lines.length && /^\s/.test(lines[j]); j++) {
    const m = lines[j].match(/^\s+-\s+(.+)$/);
    if (m) out.push(unquote(m[1]));
  }
  return out;
}

export function messageProblems(message: string, allowPlaceholder = false): string[] {
  const missing: string[] = [];
  if (!/\bWhy:\s*\S/.test(message)) missing.push('a reason ("Why: …")');
  if (!/\bInstead:\s*\S/.test(message)) missing.push('a replacement ("Instead: …")');
  const issue = allowPlaceholder ? /#(?:\d+|<nr>)/ : /#\d+/;
  if (!new RegExp(`(?:See|Fixes|Refs?)\\s+(?:\\S+)?${issue.source}`).test(message))
    missing.push('an issue or PR ("See #123")');
  return missing;
}

export function check(configPath: string, allowPlaceholder = false): string[] {
  const config = resolve(configPath);
  if (!existsSync(config)) throw new Error(`sgconfig not found: ${configPath}`);
  const base = dirname(config);
  const text = readFileSync(config, 'utf8');
  const ruleDirs = listAfter(text, 'ruleDirs');
  const testDirs = (text.match(/^\s*-?\s*testDir:\s*(\S+)/gm) ?? []).map((l) =>
    unquote(l.replace(/^\s*-?\s*testDir:\s*/, '')),
  );
  if (!ruleDirs.length) throw new Error('sgconfig has no ruleDirs');
  if (!testDirs.length) throw new Error('sgconfig has no testConfigs[].testDir');

  const testIds = new Set<string>();
  for (const dir of testDirs)
    for (const f of yamlFiles(join(base, dir)))
      for (const d of parseDocs(readFileSync(f, 'utf8'))) if (d.id) testIds.add(d.id);

  const problems: string[] = [];
  for (const dir of ruleDirs)
    for (const f of yamlFiles(join(base, dir)))
      for (const d of parseDocs(readFileSync(f, 'utf8'))) {
        if (!d.id) continue;
        const where = `${f}: rule ${d.id}`;
        const missing = messageProblems(d.message ?? '', allowPlaceholder);
        if (missing.length)
          problems.push(
            `${where}: message lacks ${missing.join(', ')}. Form: "Why: …. Instead: …. See #123."`,
          );
        if (!testIds.has(d.id))
          problems.push(`${where}: no rule test with id ${d.id} in ${testDirs.join(', ')}`);
      }
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const allowPlaceholder = args.includes('--allow-placeholder');
  const rest = args.filter((a) => a !== '--allow-placeholder');
  const i = rest.indexOf('--config');
  if (rest.length && (i < 0 || !rest[i + 1] || rest.length !== 2)) {
    console.error('usage: node check-rules.mts [--config <sgconfig.yml>] [--allow-placeholder]');
    process.exit(2);
  }
  try {
    const problems = check(i >= 0 ? rest[i + 1] : 'sgconfig.yml', allowPlaceholder);
    if (problems.length) {
      console.error(problems.join('\n'));
      process.exit(1);
    }
  } catch (e) {
    console.error((e as Error).message);
    process.exit(2);
  }
}
