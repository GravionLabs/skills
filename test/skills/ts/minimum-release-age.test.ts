import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const ts = path.resolve(__dirname, '../../../skills/ts');

describe('minimumReleaseAge of pnpm projects (#833)', () => {
  it('New-NodeProject.ps1 writes pnpm-workspace.yaml with the key', () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'nodeproj-'));
    try {
      execFileSync(
        'pwsh',
        [
          '-NoProfile',
          '-File',
          path.join(ts, 'ts-create-project/scripts/New-NodeProject.ps1'),
          '-ProjectName',
          'demo',
          '-PackageManager',
          'pnpm',
          '-OutputDirectory',
          out,
        ],
        { stdio: 'pipe' },
      );
      const yaml = fs.readFileSync(path.join(out, 'demo/pnpm-workspace.yaml'), 'utf-8');
      expect(yaml).toMatch(/^minimumReleaseAge: 10080$/m);
      expect(yaml).toContain('# minimumReleaseAgeExclude: [<package>]');
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  });

  it('ts-pnpm-workflow names the setting, the exemption and pnpm 10.16', () => {
    const skill = fs.readFileSync(path.join(ts, 'ts-pnpm-workflow/SKILL.md'), 'utf-8');
    expect(skill).toContain('minimumReleaseAge: 10080');
    expect(skill).toContain('minimumReleaseAgeExclude');
    expect(skill).toContain('10.16');
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
  });
});
