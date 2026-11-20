import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../..');
const file = path.join(root, '.claude/settings.json');
const settings = JSON.parse(fs.readFileSync(file, 'utf8')) as {
  permissions: { allow: string[]; deny: string[] };
};

// #886: the deliver allowlist is committed so every clone gets it
describe('.claude/settings.json', () => {
  it('is tracked by git', () => {
    const tracked = execFileSync('git', ['ls-files', '.claude/settings.json'], {
      cwd: root,
      encoding: 'utf8',
    });
    expect(tracked.trim()).toBe('.claude/settings.json');
  });

  it.each([
    'Bash(git:*)',
    'Bash(gh pr:*)',
    'Bash(pnpm install)',
    'Bash(pnpm run generate)',
    'Bash(node scripts/check-marketplace.mjs:*)',
    'Bash(pnpm test:*)',
    'Bash(pnpm vitest run:*)',
    'Bash(pnpm run format:*)',
    'Bash(pnpm run lint:ps)',
    'Bash(pnpm run check)',
    'Bash(poimen-server report:*)',
    'Edit',
    'Write',
  ])('allows %s', (entry) => {
    expect(settings.permissions.allow).toContain(entry);
  });

  it('denies force push and admin merge', () => {
    expect(settings.permissions.deny).toEqual(
      expect.arrayContaining([
        'Bash(git push --force:*)',
        'Bash(git push -f:*)',
        'Bash(gh pr merge --admin:*)',
      ]),
    );
  });

  it('carries no allowlist entry of the removed deliver skill (#693)', () => {
    expect(settings.permissions.allow.filter((e) => /skills\/deliver\//.test(e))).toEqual([]);
  });

  it('has no Bash wildcard', () => {
    expect(settings.permissions.allow.filter((e) => e.startsWith('Bash(*'))).toEqual([]);
  });
});
