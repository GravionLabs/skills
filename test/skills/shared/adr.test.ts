import Ajv2020 from 'ajv/dist/2020';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(root, 'skills/shared/adr/scripts/New-Adr.ps1');
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;
vi.setConfig({ testTimeout: 30000, hookTimeout: 30000 });

describe.skipIf(!hasPwsh)('New-Adr.ps1', () => {
  let worker: PwshWorker;
  let tmp: string;
  const mk = (files: Record<string, string> = {}, config?: object) => {
    const d = fs.mkdtempSync(path.join(tmp, 'case-'));
    for (const [f, c] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
      fs.writeFileSync(path.join(d, f), c);
    }
    if (config) {
      fs.mkdirSync(path.join(d, '.agents'), { recursive: true });
      fs.writeFileSync(path.join(d, '.agents/config.json'), JSON.stringify(config));
    }
    return d;
  };
  const lines = (s: string) => s.trim().split(/\r?\n/);

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'adr-'));
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(async () => {
    worker.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('creates docs/adr and 0001 in a missing directory with the template content', async () => {
    const d = mk();
    const r = await worker.run(['-Title', 'Use Postgres for Events!', '-Issue', '12'], { cwd: d });
    expect(r.status).toBe(0);
    expect(lines(r.stdout)).toEqual([path.join('docs/adr', '0001-use-postgres-for-events.md')]);
    const body = fs.readFileSync(path.join(d, 'docs/adr/0001-use-postgres-for-events.md'), 'utf8');
    const today = new Date().toISOString().slice(0, 10);
    expect(body).toMatch(/^# ADR 0001: Use Postgres for Events!$/m);
    expect(body).toMatch(/^- Status: Proposed$/m);
    expect(body).toContain(`- Date: ${today}`);
    expect(body).toMatch(/^- Issues: #12$/m);
    expect(body).toMatch(/^## Alternatives$/m);
  });

  it('numbers after the highest file and does not fill gaps; ignores other files', async () => {
    const d = mk({
      'docs/adr/0001-a.md': '',
      'docs/adr/0004-b.md': '',
      'docs/adr/README.md': '',
      'docs/adr/notes.md': '',
    });
    const r = await worker.run(['-Title', 'Next'], { cwd: d });
    expect(lines(r.stdout)).toEqual([path.join('docs/adr', '0005-next.md')]);
  });

  it('starts at 0001 in an empty existing directory', async () => {
    const d = mk({ 'docs/adr/.gitkeep': '' });
    const r = await worker.run(['-Title', 'First'], { cwd: d });
    expect(lines(r.stdout)).toEqual([path.join('docs/adr', '0001-first.md')]);
  });

  it('uses governance.adrDir from the config', async () => {
    const d = mk({ 'decisions/0007-x.md': '' }, { governance: { adrDir: 'decisions' } });
    const r = await worker.run(['-Title', 'Custom dir'], { cwd: d });
    expect(lines(r.stdout)).toEqual([path.join('decisions', '0008-custom-dir.md')]);
    expect(fs.existsSync(path.join(d, 'docs/adr'))).toBe(false);
  });

  it('keeps docs/adr when the config has no governance key', async () => {
    const d = mk({}, { format: false });
    const r = await worker.run(['-Title', 'Plain'], { cwd: d });
    expect(lines(r.stdout)).toEqual([path.join('docs/adr', '0001-plain.md')]);
  });

  it('supersedes: writes the line into the new file only and prints the old path', async () => {
    const old = '# ADR 0002: Old\n\n- Status: Accepted\n';
    const d = mk({ 'docs/adr/0002-old-thing.md': old });
    const r = await worker.run(['-Title', 'New thing', '-Supersedes', '0002'], { cwd: d });
    expect(r.status).toBe(0);
    expect(lines(r.stdout)).toEqual([
      path.join('docs/adr', '0003-new-thing.md'),
      path.join('docs/adr', '0002-old-thing.md'),
    ]);
    const body = fs.readFileSync(path.join(d, 'docs/adr/0003-new-thing.md'), 'utf8');
    expect(body).toMatch(/^- Supersedes: \[ADR 0002\]\(0002-old-thing\.md\)$/m);
    expect(fs.readFileSync(path.join(d, 'docs/adr/0002-old-thing.md'), 'utf8')).toBe(old);
  });

  it('supersedes an unknown number: error, nothing written', async () => {
    const d = mk({ 'docs/adr/0001-a.md': '' });
    const r = await worker.run(['-Title', 'X', '-Supersedes', '0009'], { cwd: d });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('ADR 0009 does not exist');
    expect(fs.readdirSync(path.join(d, 'docs/adr'))).toEqual(['0001-a.md']);
  });

  it('never overwrites: a title without a usable slug fails', async () => {
    const d = mk();
    const r = await worker.run(['-Title', '!!!'], { cwd: d });
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('no letters or digits');
  });

  it('repeated runs create new files, never replace one', async () => {
    // the next number is highest + 1, so a clash needs a file that sorts the same number: a duplicate is impossible by name,
    // hence the script is run twice and both files must exist with different numbers
    const d = mk();
    await worker.run(['-Title', 'Same'], { cwd: d });
    const r = await worker.run(['-Title', 'Same'], { cwd: d });
    expect(lines(r.stdout)).toEqual([path.join('docs/adr', '0002-same.md')]);
    expect(fs.readdirSync(path.join(d, 'docs/adr')).sort()).toEqual([
      '0001-same.md',
      '0002-same.md',
    ]);
  });
});

describe('governance schema and docs', () => {
  const schema = JSON.parse(read('skills/shared/implementation/schema/config.schema.json'));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  const gov = schema.properties.governance;

  it('defines the governance keys and defaults', () => {
    expect(gov.additionalProperties).toBe(false);
    expect(Object.keys(gov.properties).sort()).toEqual(
      ['adrDir', 'adrPaths', 'skipLabels', 'specDir', 'specMap', 'specMode'].sort(),
    );
    expect(gov.properties.adrDir.default).toBe('docs/adr');
    expect(gov.properties.adrPaths.default).toEqual([]);
    expect(gov.properties.specDir.default).toBe('docs/specs');
    expect(gov.properties.specMode.enum).toEqual(['warn', 'require']);
    expect(gov.properties.specMode.default).toBe('warn');
    expect(gov.properties.skipLabels.default).toEqual(['skip-adr']);
  });

  it('accepts the documented example and rejects unknown keys and bad modes', () => {
    const ok = {
      governance: {
        adrDir: 'docs/adr',
        adrPaths: ['infra/**'],
        specMap: { 'apps/bff/**': 'docs/specs/bff.md' },
        specMode: 'require',
        skipLabels: ['skip-adr'],
      },
    };
    expect(validate(ok)).toBe(true);
    expect(validate({ governance: { adrDirectory: 'x' } })).toBe(false);
    expect(validate({ governance: { specMode: 'block' } })).toBe(false);
  });

  it('project-config.md documents every governance key', () => {
    const doc = read('docs/usage/project-config.md');
    for (const k of Object.keys(gov.properties)) expect(doc).toContain(`\`${k}\``);
    expect(doc).toContain('apps/bff/**');
    expect(doc).toContain('docs/specs/frontend.md');
  });

  it('SKILL.md stays within 100 lines; github-issue points at decisions.md', () => {
    expect(read('skills/shared/adr/SKILL.md').split('\n').length).toBeLessThanOrEqual(100);
    expect(read('skills/github/github-issue/SKILL.md')).toContain('references/decisions.md');
    expect(read('skills/github/github-issue/references/decisions.md')).toContain('needs-decision');
  });
});
