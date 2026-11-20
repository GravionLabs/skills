// `any` / `@ts-nocheck` ratchet: copy to `scripts/ratchets/check-ts-any-ratchet.mts`. Counts, per .ts/.tsx/.mts file,
// `: any`, `as any`, `<any>`, `@ts-nocheck` and `@ts-ignore` and freezes the existing ones in a count baseline
// (`path` → number). A higher count fails; a lower count fails as stale until `--prune`.
// Comments and strings are not scanned for `any`; `@ts-nocheck` / `@ts-ignore` count only as directives at the start of a comment.
// `run-ratchets.mts` runs it and passes `--init` / `--prune`.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import * as path from 'node:path';

const BASELINE = path.resolve('scripts/ratchets/baselines/ts-any.json');
// Where the ratchet skill's baseline.mts is installed in this repository.
const HELPER = process.env.RATCHET_BASELINE_HELPER ?? path.resolve('.agents/skills/ratchet/scripts/baseline.mts');
const SOURCE = /\.(?:ts|tsx|mts)$/;
const EXCLUDE = /(?:^|\/)(?:node_modules|\.git|dist|build|out|coverage|bin|obj|target|vendor|\.next|\.angular)\//;

const CODE_FORMS: RegExp[] = [/:\s*any\b/g, /\bas\s+any\b/g, /<\s*any\s*>/g];
const DIRECTIVE = /^[ \t]*\*?[ \t]*@ts-(?:nocheck|ignore)\b/gm;

// Splits a source into code (comments and strings blanked) and the text of its comments.
function split(text: string): { code: string; comments: string[] } {
  let code = '';
  const comments: string[] = [];
  const braces: number[] = []; // template depth markers: brace depth at each open `${`
  let depth = 0;
  let i = 0;
  const blank = (s: string) => s.replace(/[^\n]/g, ' ');
  const template = () => {
    // inside a template literal, from after the opening backtick or a closing `}` of `${}`
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') { code += blank(text.slice(i, i + 2)); i += 2; continue; }
      if (c === '`') { code += ' '; i++; return; }
      if (c === '$' && text[i + 1] === '{') { code += '  '; i += 2; braces.push(depth++); return; }
      code += c === '\n' ? '\n' : ' ';
      i++;
    }
  };
  while (i < text.length) {
    const c = text[i];
    const two = text.slice(i, i + 2);
    if (two === '//') {
      const end = text.indexOf('\n', i);
      const stop = end === -1 ? text.length : end;
      comments.push(text.slice(i + 2, stop));
      code += blank(text.slice(i, stop));
      i = stop;
    } else if (two === '/*') {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      comments.push(text.slice(i + 2, end === -1 ? stop : end));
      code += blank(text.slice(i, stop));
      i = stop;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < text.length && text[j] !== c && text[j] !== '\n') j += text[j] === '\\' ? 2 : 1;
      code += blank(text.slice(i, j + 1));
      i = j + 1;
    } else if (c === '`') {
      code += ' ';
      i++;
      template();
    } else {
      if (c === '{') depth++;
      if (c === '}') {
        depth--;
        if (braces.length > 0 && braces[braces.length - 1] === depth) {
          braces.pop();
          code += ' ';
          i++;
          template();
          continue;
        }
      }
      code += c;
      i++;
    }
  }
  return { code, comments };
}

function count(text: string): number {
  const { code, comments } = split(text);
  const inCode = CODE_FORMS.reduce((sum, re) => sum + (code.match(re)?.length ?? 0), 0);
  return inCode + comments.reduce((sum, c) => sum + (c.match(DIRECTIVE)?.length ?? 0), 0);
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
