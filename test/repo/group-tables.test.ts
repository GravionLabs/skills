import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../..');

// A bare pipe splits a table cell even inside a code span, so every row needs
// as many cells as the header.
function groupTable(file: string): string[] {
  const lines = fs.readFileSync(path.join(root, file), 'utf-8').split('\n');
  const start = lines.findIndex((l) => /^\| Group\s/.test(l));
  const rows: string[] = [];
  for (let i = start; i >= 0 && i < lines.length && lines[i].startsWith('|'); i++)
    rows.push(lines[i]);
  return rows;
}

const cells = (row: string) => row.replace(/\\\|/g, '').split('|').length - 2;

describe('group tables of AGENTS.md and README.md (#229)', () => {
  it.each(['README.md'])('%s: every row has the cells of the header', (file) => {
    const rows = groupTable(file);
    expect(rows.length).toBeGreaterThan(5);
    const expected = cells(rows[0]);
    for (const row of rows) expect(cells(row), row.slice(0, 40)).toBe(expected);
  });

  it('README.md: the github row names close with --move-to', () => {
    const row = groupTable('README.md').find((r) => r.startsWith('| `github`'));
    expect(row).toMatch(/close/);
    expect(row).toMatch(/--move-to/);
  });

  it('AGENTS.md: the github reference file names close with --move-to, AGENTS.md names it', () => {
    const text = fs.readFileSync(path.join(root, 'docs/agents-md-refs/github.md'), 'utf-8');
    expect(text).toMatch(/close/);
    expect(text).toMatch(/--move-to/);
    expect(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf-8')).toContain(
      'docs/agents-md-refs/github.md',
    );
  });
});

describe('github-project is part of this repository (#428)', () => {
  it.each([
    'AGENTS.md',
    'README.md',
    'docs/agents-md-refs/github.md',
    'skills/delivery/skills-manage/references/groups.md',
  ])('%s does not say github-project is outside the repository', (file) => {
    const text = fs.readFileSync(path.join(root, file), 'utf-8');
    expect(text).not.toMatch(/not in this repository/);
    expect(text).not.toMatch(/github-project[^.;|]*ships from GravionLabs\/ci/);
  });
});
