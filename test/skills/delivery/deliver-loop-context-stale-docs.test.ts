import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const loop = readFileSync(path.join(root, 'skills/delivery/deliver/references/loop.md'), 'utf8');

describe('stale context.md removal documented (#578, #596)', () => {
  it('says the loop deletes a stale .agents/deliver-loop/context.md when no upstream PR merged', () => {
    expect(loop).toMatch(/deletes a stale `\.agents\/deliver-loop\/context\.md`/);
    expect(loop).toMatch(/no upstream PR merged/);
    expect(loop).toContain('(#578)');
  });
});
