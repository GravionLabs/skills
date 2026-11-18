import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  create,
  mergeMethodFor,
} from '../../../skills/delivery/deliver/scripts/tracker/github.mts';

describe('merge method per base', () => {
  it.each([
    ['main', 'main', 'merge'],
    ['release/next', 'main', 'squash'],
    ['develop', 'trunk', 'squash'],
  ])('base %s with default %s merges with %s', (base, def, method) => {
    expect(mergeMethodFor(base, def)).toBe(method);
  });

  describe('the GitHub tracker', () => {
    let dir: string;
    let log: string;
    const oldPath = process.env.PATH;
    beforeAll(() => {
      dir = mkdtempSync(path.join(tmpdir(), 'merge-method-'));
      log = path.join(dir, 'calls.log');
      writeFileSync(
        path.join(dir, 'gh'),
        `#!/bin/sh
echo "$*" >> "${log}"
case "$*" in
  *nameWithOwner*) echo o/r ;;
  *defaultBranchRef*) echo main ;;
esac
`,
      );
      chmodSync(path.join(dir, 'gh'), 0o755);
      process.env.PATH = `${dir}${path.delimiter}${oldPath}`;
    });
    afterAll(() => {
      process.env.PATH = oldPath;
    });

    const merged = (base: string): string => {
      const tracker = create({
        cwd: dir,
        base,
        selection: { issues: [] } as never,
        trustAuthors: false,
      });
      writeFileSync(log, '');
      tracker.merge({ id: 7, title: 'fix: x', branch: 'fix/7-x' } as never, 'abc');
      return readFileSync(log, 'utf8');
    };

    it('uses a merge commit into the default branch', () => {
      expect(merged('main')).toContain('merge_method=merge');
    });
    it('squashes into another base', () => {
      expect(merged('release/next')).toContain('merge_method=squash');
    });
  });
});
