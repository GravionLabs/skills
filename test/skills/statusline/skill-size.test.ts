import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const skill = fs.readFileSync(path.join(root, 'skills/context-statusline/SKILL.md'), 'utf-8');
const doc = fs.readFileSync(path.join(root, 'docs/usage/statusline.md'), 'utf-8');

describe('context-statusline SKILL.md (#773)', () => {
  it('stays within 35 lines and keeps install commands, "What you get" and Rules', () => {
    expect(skill.trimEnd().split('\n').length).toBeLessThanOrEqual(35);
    for (const k of ['Install-Statusline.ps1 -WhatIf', '## What you get', '## Rules']) {
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
