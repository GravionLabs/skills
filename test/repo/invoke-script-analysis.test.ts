import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../helpers/pwsh-worker';

const repoRoot = path.resolve(__dirname, '../..');
const script = path.join(repoRoot, 'scripts/Invoke-ScriptAnalysis.ps1');

const hasPwsh = spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' }).status === 0;
const hasAnalyzer =
  hasPwsh &&
  spawnSync('pwsh', [
    '-NoProfile',
    '-Command',
    'if (Get-Module -ListAvailable PSScriptAnalyzer) { exit 0 } exit 1',
  ]).status === 0;

describe.skipIf(!hasAnalyzer)('Invoke-ScriptAnalysis.ps1', () => {
  // one pwsh worker loads PSScriptAnalyzer once instead of once per case
  let worker: PwshWorker;
  const roots: string[] = [];
  beforeAll(() => {
    worker = new PwshWorker(script);
  });
  afterAll(() => {
    worker.close();
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });

  // Fixture root with the repository settings and one script under skills/.
  const run = (content: string) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'psa-'));
    roots.push(root);
    fs.copyFileSync(
      path.join(repoRoot, 'PSScriptAnalyzerSettings.psd1'),
      path.join(root, 'PSScriptAnalyzerSettings.psd1'),
    );
    fs.mkdirSync(path.join(root, 'skills'));
    fs.writeFileSync(path.join(root, 'skills', 'sample.ps1'), content);
    return worker.run(['-Root', root], { cwd: root });
  };

  it('exits 0 on a clean fixture and does not flag rules excluded in the settings file', async () => {
    // Write-Host (PSAvoidUsingWriteHost) is excluded in PSScriptAnalyzerSettings.psd1
    const result = await run("Get-ChildItem -Path . | Out-Null\nWrite-Host 'hi'\n");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('no findings');
  });

  it('exits 1 on a fixture with a violation and prints file, line and rule', async () => {
    const result = await run("$unused = 1\nInvoke-Expression 'Get-Date'\n");
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('sample.ps1:2');
    expect(result.stdout).toContain('PSAvoidUsingInvokeExpression');
  });
});

describe('lint:ps wiring', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, 'package.json'), 'utf-8'));

  it('lint:ps calls the script and check includes it', () => {
    expect(pkg.scripts['lint:ps']).toBe('pwsh scripts/Invoke-ScriptAnalysis.ps1');
    expect(pkg.scripts.check).toContain('pnpm run lint:ps');
  });
});
