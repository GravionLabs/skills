import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const templates = path.join(root, '.github/ISSUE_TEMPLATE');
const expected: Record<string, string> = {
  'epic.md': '[Epic] ',
  'feature.md': '[Feature] ',
  'pbi.md': '[PBI] ',
  'task.md': '[Task] ',
  'bug_report.md': '[Bug] ',
};
const titleOf = (file: string): string | undefined =>
  /^title: '(.*)'$/m.exec(readFileSync(file, 'utf8'))?.[1];

describe('issue templates default to the level prefix', () => {
  for (const [name, prefix] of Object.entries(expected)) {
    it(`${name} title is exactly ${prefix.trim()}`, () => {
      expect(titleOf(path.join(templates, name))).toBe(prefix);
    });
  }

  it('holds exactly the level templates', () => {
    const md = readdirSync(templates)
      .filter((f) => f.endsWith('.md'))
      .sort();
    expect(md).toEqual(Object.keys(expected).sort());
  });
});

describe('no skill prescribes an unprefixed Epic/Feature title', () => {
  // Reading-side mentions only: legacy forms, parent links, status grouping, plan summaries.
  const allowed =
    /Legacy titles \(`Epic: |legacy `Epic: `|Parent (Epic|Feature): #|Epic: grouped per Feature|\(Feature: the capability;/;

  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : [p];
    });

  const files = walk(path.join(root, 'skills')).filter((f) =>
    /(SKILL|references[\\/].*)\.md$/.test(f),
  );

  it('scans skill documents', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('has no unallowed `Epic: ` or `Feature: ` title line', () => {
    const offenders = files.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .map((line, i) => ({ line, at: `${path.relative(root, f)}:${i + 1}` }))
        .filter(({ line }) => /\b(Epic|Feature): /.test(line) && !allowed.test(line))
        .map(({ at }) => at),
    );
    expect(offenders).toEqual([]);
  });
});
