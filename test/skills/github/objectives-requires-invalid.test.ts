import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const ref = readFileSync(
  path.join(root, 'skills/github/github-issue/references/objectives.md'),
  'utf8',
);

describe('Requires invalid <owner>/<repo> is ignored (#574, #596)', () => {
  it('states that an invalid ref is reported on stderr and ignored', () => {
    expect(ref).toMatch(/invalid `<owner>\/<repo>`/);
    expect(ref).toContain("Requires: invalid <owner>/<repo> '<ref>' in <source> ignored");
    expect(ref).toMatch(/on stderr/);
    expect(ref).toMatch(/other `Requires:` lines still count/);
  });
});
