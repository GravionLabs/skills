import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../../..');
const grep = (pattern: string, dir: string): string[] => {
  try {
    return execFileSync('git', ['grep', '-liE', pattern, '--', dir], {
      cwd: root,
      encoding: 'utf8',
    })
      .split('\n')
      .filter(Boolean);
  } catch {
    return [];
  }
};

describe('ng skills content', () => {
  it('has no project-specific Sakai or gv- content in skills/', () => {
    expect(grep('sakai|gv-', 'skills/')).toEqual([]);
  });
  it('keeps the per-client MCP config table once, in ng-implementation', () => {
    expect(grep('\\.cursor/mcp\\.json', 'skills/')).toEqual([
      'skills/ng-implementation/references/mcp.md',
    ]);
  });
});
