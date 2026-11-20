import path from 'node:path';
import { describe, expect, it } from 'vitest';

const mod = path.resolve(__dirname, '../../../skills/delivery/deliver/scripts/progress-bar.mts');
const { progressLine, MIN_WIDTH } = (await import(
  mod
)) as typeof import('../../../skills/delivery/deliver/scripts/progress-bar.mts');

describe('progressLine', () => {
  it.each([
    [1, 4, '[█████░░░░░░░░░░░░░░░] 1 of 4'],
    [2, 4, '[██████████░░░░░░░░░░] 2 of 4'],
    [4, 4, '[████████████████████] 4 of 4'],
  ])('shows %i of %i as a bar', (x, y, line) => {
    expect(progressLine(x, y, 80)).toBe(line);
  });

  it('is plain text, without color codes', () => {
    expect(progressLine(2, 3, 80)).not.toContain('\x1b');
  });

  it('shrinks the bar to the width and drops it below the minimum width', () => {
    const narrow = progressLine(2, 4, MIN_WIDTH);
    expect(narrow.length).toBeLessThanOrEqual(MIN_WIDTH);
    expect(narrow).toMatch(/^\[.+\] 2 of 4$/);
    expect(progressLine(2, 4, MIN_WIDTH - 1)).toBe('2 of 4');
  });

  it('lets the total follow x when a repair Bug adds an issue', () => {
    expect(progressLine(5, 4, 80)).toMatch(/ 5 of 5$/);
  });
});
