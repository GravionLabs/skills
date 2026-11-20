// Checks the gitleaks allowlists of a repository: every fingerprint of `.gitleaksignore` has a `#` comment
// line above it that gives the reason, and every `[[allowlists]]` entry of `.gitleaks.toml` has a `description`.
// Usage: node check-allowlist.mts [repo-dir]   (default: current directory)
// Exit 0 ok, 1 violations, 2 usage error. Node >= 22.18 (erasable TypeScript, no dependencies).
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function checkIgnore(text: string, file = '.gitleaksignore'): string[] {
  const problems: string[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((line, i) => {
    const t = line.trim();
    if (t === '' || t.startsWith('#')) return;
    const prev = lines[i - 1]?.trim() ?? '';
    if (!/^#\s*\S/.test(prev))
      problems.push(
        `${file}:${i + 1}: fingerprint without a reason comment on the line above: ${t}`,
      );
  });
  return problems;
}

export function checkToml(text: string, file = '.gitleaks.toml'): string[] {
  const problems: string[] = [];
  const entries: { line: number; body: string[] }[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const t = raw.trim();
    if (/^\[\[allowlists\]\]\s*(#.*)?$/.test(t)) entries.push({ line: i + 1, body: [] });
    else if (t.startsWith('[')) entries.push({ line: -1, body: [] });
    else if (entries.length) entries.at(-1)?.body.push(t);
  });
  for (const e of entries) {
    if (e.line < 0) continue;
    const ok = e.body.some((l) => /^description\s*=\s*("[^"]*\S[^"]*"|'[^']*\S[^']*')/.test(l));
    if (!ok) problems.push(`${file}:${e.line}: [[allowlists]] entry without a description`);
  }
  return problems;
}

export function check(dir: string): string[] {
  const problems: string[] = [];
  const ignore = join(dir, '.gitleaksignore');
  if (existsSync(ignore)) problems.push(...checkIgnore(readFileSync(ignore, 'utf8')));
  const toml = join(dir, '.gitleaks.toml');
  if (existsSync(toml)) problems.push(...checkToml(readFileSync(toml, 'utf8')));
  return problems;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.length > 1 || args[0]?.startsWith('-')) {
    console.error('usage: node check-allowlist.mts [repo-dir]');
    process.exit(2);
  }
  const dir = resolve(args[0] ?? '.');
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    console.error(`check-allowlist: not a directory: ${dir}`);
    process.exit(2);
  }
  const problems = check(dir);
  for (const p of problems) console.error(p);
  if (problems.length) {
    console.error(
      'Add a `# reason` line above the fingerprint or a `description` to the entry (references/allowlist.md).',
    );
    process.exit(1);
  }
}
