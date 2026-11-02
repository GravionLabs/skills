import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const skill = fs.readFileSync(
  path.join(root, 'skills/statusline/context-statusline/SKILL.md'),
  'utf-8',
);
const doc = fs.readFileSync(path.join(root, 'docs/usage/statusline.md'), 'utf-8');

describe('context-statusline SKILL.md (#773)', () => {
  it('stays within 45 lines and keeps install commands, "What you get" and Rules', () => {
    expect(skill.trimEnd().split('\n').length).toBeLessThanOrEqual(45);
    for (const k of [
      'Install-Statusline.ps1 -WhatIf',
      '## What you get',
      '## Context warning hook',
      '## Rules',
    ]) {
      expect(skill).toContain(k);
    }
  });

  it('has no installer bullet list; the details live in docs/usage/statusline.md', () => {
    expect(skill).not.toContain('The installer:');
    expect(skill).toContain('docs/usage/statusline.md');
    expect(doc).toContain('### Installer details');
    expect(doc).toContain('settings.json.bak-<timestamp>');
  });
});
