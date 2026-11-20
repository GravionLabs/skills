import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as os from 'node:os';
import * as fs from 'node:fs';
import * as path from 'node:path';

const skillDir = path.resolve(__dirname, '../../../skills/delivery/skills-manage');
const script = fs.readFileSync(path.join(skillDir, 'scripts/Install-Skills.ps1'), 'utf8');
const doc = fs.readFileSync(path.join(skillDir, 'references/after-install.md'), 'utf8');

describe('skills-manage .gitignore note for .agents/', () => {
  it('the installer note names the !.agents/lessons/ exception', () => {
    const note = script.split('\n').find((l) => l.includes('.gitignore ignores .agents/'));
    expect(note).toBeDefined();
    expect(note).toContain('!.agents/skills/');
    expect(note).toContain('!.agents/config.json');
    expect(note).toContain('!.agents/lessons/');
  });

  it('after-install.md names the !.agents/lessons/ exception', () => {
    const line = doc.split('\n').find((l) => l.includes('`.gitignore`') && l.includes('.agents/*'));
    expect(line).toBeDefined();
    expect(line).toContain('`!.agents/lessons/`');
  });
});

const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe.skipIf(!hasPwsh)('skills-manage .agents/proof/ hint', () => {
  const notes = (gitignore: string): string[] => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'siproof-')));
    try {
      fs.writeFileSync(path.join(tmp, '.gitignore'), gitignore);
      const r = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-File',
          path.join(skillDir, 'scripts/Install-Skills.ps1'),
          '-DryRun',
          '-Groups',
          'shared',
        ],
        { encoding: 'utf8', cwd: tmp, env: { ...process.env, HOME: tmp, USERPROFILE: tmp } },
      );
      return (JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))).notes ?? []) as string[];
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };

  it('hints when .gitignore lacks .agents/proof/', () => {
    expect(notes('node_modules/\n').some((n) => n.includes('.agents/proof/'))).toBe(true);
  });

  it('stays silent when .gitignore has it', () => {
    expect(notes('node_modules/\n.agents/proof/\n').some((n) => n.includes('.agents/proof/'))).toBe(
      false,
    );
  });
});
