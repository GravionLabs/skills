import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// #537: Test-ContractChange.ps1 matches changed files against contracts.paths
const SKILL = path.resolve(__dirname, '../../../skills/delivery/deliver');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe('deliver contract-change docs (#537)', () => {
  it('step 6 names the script, label and line; SKILL.md stays within 100 lines', () => {
    const skill = fs.readFileSync(path.join(SKILL, 'SKILL.md'), 'utf8');
    expect(skill).toContain('Test-ContractChange.ps1');
    expect(skill).toContain('#<nr> pr: contract-change (<n> paths)');
    expect(skill.split('\n').length).toBeLessThanOrEqual(100);
    const schema = JSON.parse(
      fs.readFileSync(
        path.resolve(SKILL, '../../shared/implementation/schema/config.schema.json'),
        'utf8',
      ),
    );
    expect(schema.properties.contracts.properties.paths.type).toBe('array');
  });
});

describe.skipIf(!hasPwsh)('Test-ContractChange.ps1 (#537)', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'contract-'));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  const run = (config: object | null, files: string[]) => {
    const cfg = path.join(dir, 'config.json');
    fs.rmSync(cfg, { force: true });
    if (config) fs.writeFileSync(cfg, JSON.stringify(config));
    const r = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-File',
        path.join(SKILL, 'scripts/Test-ContractChange.ps1'),
        '-Config',
        cfg,
        '-Files',
        files.join(','),
      ],
      { encoding: 'utf8' },
    );
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };
  const config = { contracts: { paths: ['SPEC.md', 'schema/**', 'test/fixtures/**/*.json'] } };

  it('hit: reports the matching paths', () => {
    const r = run(config, ['src/a.ts', 'SPEC.md', 'schema/deep/x.json', 'test/fixtures/a/b.json']);
    expect(r).toMatchObject({ configured: true, hit: true, count: 3 });
    expect(r.paths).not.toContain('src/a.ts');
  });

  it('no hit', () => {
    const r = run(config, ['src/a.ts', 'docs/SPEC.md', 'test/fixtures/a.txt']);
    expect(r).toMatchObject({ configured: true, hit: false, count: 0 });
  });

  it.each([
    ['no contracts entry', { format: false }],
    ['no config file', null],
  ])('%s: nothing changes', (_n, cfg) => {
    expect(run(cfg, ['SPEC.md'])).toMatchObject({ configured: false, hit: false, count: 0 });
  });
});
