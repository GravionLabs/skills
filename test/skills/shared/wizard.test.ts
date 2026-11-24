import * as fs from 'fs';
import * as path from 'path';
import { spawnSync } from 'child_process';

const root = path.resolve(__dirname, '../../..');
const dir = path.join(root, 'skills/shared/wizard');
const read = (f: string): string => fs.readFileSync(path.join(dir, f), 'utf-8');
const skill = read('SKILL.md');
const sh = read('templates/wizard.sh');
const ps1 = read('templates/wizard.ps1');

const have = (cmd: string, args: string[]): boolean =>
  spawnSync(cmd, args, { encoding: 'utf-8' }).status === 0;

describe('wizard skill', () => {
  it('is within 100 lines and model-invocable', () => {
    expect(skill.trimEnd().split('\n').length).toBeLessThanOrEqual(100);
    expect(skill).not.toContain('disable-model-invocation');
  });

  it('scopes from the repository, confirms stages and never invents UI steps', () => {
    expect(skill).toMatch(/`\.env`, `\.env\.example`/);
    expect(skill).toContain('`secrets.*` and `vars.*`');
    expect(skill).toMatch(/Confirm; the user may add, drop or reorder/);
    expect(skill).toMatch(/Never invent UI steps/);
  });

  it('says in the description that it is not for steps the agent can do itself', () => {
    const description = /^description: (.*)$/m.exec(skill)?.[1] ?? '';
    expect(description).toMatch(/Not for steps the agent can do itself/);
  });

  it('keeps secrets hidden, never echoed or logged', () => {
    expect(skill).toMatch(/read hidden/);
    expect(skill).toMatch(/never echoed, never logged/);
  });
});

describe('wizard templates', () => {
  it('carry the MIT notice and the library markers', () => {
    for (const t of [sh, ps1]) {
      expect(t).toContain('MIT License');
      expect(t).toContain('mattpocock/skills');
      expect(t).toContain('BEGIN wizard library');
      expect(t).toContain('END wizard library');
    }
  });

  it('provide the same helpers in both shells', () => {
    for (const fn of [
      'banner',
      'stage',
      'open_url',
      'ask',
      'ask_secret',
      'write_env',
      'set_secret',
      'set_var',
      'pause',
      'confirm',
      'finish',
    ]) {
      expect(sh).toMatch(new RegExp(`^${fn}\\(\\)`, 'm'));
    }
    for (const fn of [
      'Show-Banner',
      'Start-Stage',
      'Open-Url',
      'Read-Value',
      'Read-SecretValue',
      'Set-EnvValue',
      'Set-GhSecret',
      'Set-GhVariable',
      'Suspend-Wizard',
      'Confirm-Wizard',
      'Complete-Wizard',
    ]) {
      expect(ps1).toMatch(new RegExp(`^function ${fn}\\b`, 'm'));
    }
  });

  it('read secrets hidden and pass them to gh by stdin', () => {
    expect(sh).toContain('read -rs input');
    expect(sh).toContain('printf \'%s\' "$value" | gh secret set');
    expect(ps1).toContain('-AsSecureString');
    expect(ps1).toContain('$Value | & gh secret set $Name');
    expect(ps1).not.toMatch(/gh secret set \$Name --body/);
  });

  it('wizard.sh parses with bash -n', () => {
    const r = spawnSync('bash', ['-n', path.join(dir, 'templates/wizard.sh')], {
      encoding: 'utf-8',
    });
    expect(r.status, r.stderr).toBe(0);
  });

  it.skipIf(!have('shellcheck', ['--version']))('wizard.sh passes shellcheck', () => {
    const r = spawnSync('shellcheck', [path.join(dir, 'templates/wizard.sh')], {
      encoding: 'utf-8',
    });
    expect(r.status, r.stdout).toBe(0);
  });

  it.skipIf(
    !have('pwsh', [
      '-NoProfile',
      '-c',
      'Get-Module -ListAvailable PSScriptAnalyzer | Out-Null; if (-not (Get-Module -ListAvailable PSScriptAnalyzer)) { exit 1 }',
    ]),
  )(
    'wizard.ps1 passes PSScriptAnalyzer',
    () => {
      const r = spawnSync(
        'pwsh',
        [
          '-NoProfile',
          '-Command',
          `$f = Invoke-ScriptAnalyzer -Path '${path.join(dir, 'templates/wizard.ps1')}' -Settings '${path.join(root, 'PSScriptAnalyzerSettings.psd1')}'; $f | Format-List | Out-String | Write-Host; exit @($f).Count`,
        ],
        { encoding: 'utf-8' },
      );
      expect(r.status, r.stdout).toBe(0);
    },
    30000,
  );

  it('is registered in marketplace.json, groups.json and the README', () => {
    const market = fs.readFileSync(path.join(root, '.claude-plugin/marketplace.json'), 'utf-8');
    const groups = JSON.parse(
      fs.readFileSync(
        path.join(root, 'skills/delivery/skills-manage/scripts/groups.json'),
        'utf-8',
      ),
    ) as Record<string, string[]>;
    expect(market).toContain('./skills/shared/wizard');
    expect(groups.shared).toContain('wizard');
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf-8')).toContain('`wizard`');
  });
});
