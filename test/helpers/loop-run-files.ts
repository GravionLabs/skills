import * as fs from 'fs';
import * as path from 'path';

// Parsed lines of every JSONL file in `dir` (missing dir: none); used for the loop's event files and progress.jsonl.
export function readJsonl(dir: string): any[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.jsonl'))
    .flatMap((f) => fs.readFileSync(path.join(dir, f), 'utf8').split('\n').filter(Boolean))
    .map((l) => JSON.parse(l));
}

// The last non-empty line of a text.
export const lastLine = (text: string): string =>
  text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop() ?? '';
