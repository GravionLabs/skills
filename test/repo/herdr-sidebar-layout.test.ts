import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve(__dirname, '../..');
const guide = readFileSync(path.join(root, 'docs/guides/herdr.md'), 'utf8');
const reference = readFileSync(
  path.join(root, 'skills/delivery/deliver/references/terminal-backends.md'),
  'utf8',
);

const sidebarSnippets = (md: string): string[] =>
  [...md.matchAll(/```toml\n([\s\S]*?)```/g)]
    .map((m) => m[1])
    .filter((t) => t.includes('[ui.sidebar.agents]'));

describe('herdr sidebar layout has one source of truth', () => {
  it('references/terminal-backends.md holds the layout', () => {
    expect(sidebarSnippets(reference)).toHaveLength(1);
  });

  it('the guide links to the references sidebar layout', () => {
    expect(guide).toContain(
      '](../../skills/delivery/deliver/references/terminal-backends.md#sidebar-layout)',
    );
  });

  it('the guide repeats no sidebar snippet that differs from the references one', () => {
    const source = sidebarSnippets(reference);
    for (const snippet of sidebarSnippets(guide)) expect(source).toContain(snippet);
  });
});
