import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const read = (p: string) => readFileSync(path.join(root, p), 'utf8');

const docs = [
  'skills/delivery/deliver/references/loop.md',
  'skills/delivery/deliver/references/help.md',
  'site/guides/deliver.md',
  'site/delivery.md',
  'skills/delivery/skills-manage/references/after-install.md',
];

describe('loop -Model default docs (#349)', () => {
  it.each(docs)('%s does not name sonnet as the -Model default', (file) => {
    const text = read(file);
    expect(text).not.toMatch(/default\s+`sonnet`/);
    expect(text).not.toMatch(/-Model sonnet/);
  });

  it('help text describes the tier default and -Model as override', () => {
    const line = read('skills/delivery/deliver/references/help.md')
      .split('\n')
      .find((l) => l.startsWith('- `-Model'));
    expect(line).toMatch(/tier/);
    expect(line).toMatch(/auto/);
    expect(line).toMatch(/override/);
  });
});
