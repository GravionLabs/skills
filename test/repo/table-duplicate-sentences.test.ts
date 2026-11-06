import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');

// Split a table row on ". ", "; " and "), " boundaries; an identical fragment of
// >= 40 characters twice in one row is a copy/paste slip (#359).
function repeatedSentences(row: string, min = 40): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const part of row.split(/\. |; |\), /)) {
    const s = part.trim();
    if (s.length < min) continue;
    if (seen.has(s)) dup.add(s);
    seen.add(s);
  }
  return [...dup];
}

describe('table rows do not repeat a sentence (#359)', () => {
  it('detects a repeated sentence', () => {
    const s = 'a long sentence that is surely over forty characters';
    expect(repeatedSentences(`${s}; other; ${s}`)).toEqual([s]);
  });

  it.each(['AGENTS.md', 'README.md'])('%s: no row repeats a sentence', (file) => {
    const rows = fs
      .readFileSync(path.join(root, file), 'utf-8')
      .split('\n')
      .filter((l) => l.startsWith('|'));
    for (const row of rows) expect(repeatedSentences(row), row.slice(0, 40)).toEqual([]);
  });
});
