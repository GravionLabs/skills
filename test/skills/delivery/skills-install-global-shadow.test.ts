import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

const doc = fs.readFileSync(
  path.resolve(__dirname, '../../../skills/delivery/skills-install/references/after-install.md'),
  'utf8',
);

function section(heading: string): string | undefined {
  const start = doc.indexOf(`\n## ${heading}\n`);
  if (start < 0) return undefined;
  const rest = doc.slice(start + 1);
  const next = rest.indexOf('\n## ', 1);
  return next < 0 ? rest : rest.slice(0, next);
}

describe('skills-install after-install: global copy shadows the project install', () => {
  const body = section('Global and project copies');

  it('has the section', () => {
    expect(body).toBeDefined();
  });

  it('says a skill in both places may resolve to the global copy', () => {
    expect(body).toContain('globally (`-g`) and in the project');
    expect(body).toContain('may resolve to the global copy');
  });

  it('names the remedy: update the global copy or remove it', () => {
    expect(body).toContain('`npx skills update -g`');
    expect(body).toMatch(/remove it/);
  });

  it('names how to see which copy OpenCode loads', () => {
    expect(body).toContain('`opencode debug skill`');
  });

  it('names no precedence for Claude Code or Copilot', () => {
    expect(body).not.toMatch(/Claude Code|Copilot/);
  });
});
