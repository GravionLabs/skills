import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (skill: string): string =>
  readFileSync(path.resolve(__dirname, `../../../skills/go/${skill}/SKILL.md`), 'utf8');
const goTest = read('go-test');
const goImplementation = read('go-implementation');
const reviewRules = /^## Review rules$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(goTest)?.[1] ?? '';

describe('go-test ## Review rules', () => {
  it('has the section and stays within 100 lines', () => {
    expect(goTest).toMatch(/^## Review rules$/m);
    expect(goTest.split('\n').length).toBeLessThanOrEqual(100);
  });
  it('requires a test that simulates a missing tool to restrict PATH to the tools it needs', () => {
    const rule = reviewRules.split('\n').find((l) => l.includes('PATH')) ?? '';
    expect(rule).toMatch(/^- (🔴|🟡|🟢) /u);
    expect(rule).toContain('only the tools the test needs');
    expect(rule).toContain('/usr/bin:/bin');
  });
});

describe('go-implementation Review rules', () => {
  it('has no pointer to the Review rules of go-test, code-review reads them itself', () => {
    const section =
      /^## Review rules$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(goImplementation)?.[1] ?? '';
    expect(section).not.toMatch(/Review rules.*go-test|go-test.*Review rules/);
    expect(section).toContain('- 🟢 Tests follow `go-test`');
  });
});
