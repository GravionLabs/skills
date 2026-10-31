import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../helpers/pwsh-worker';

const repoRoot = path.resolve(__dirname, '../..');
const script = path.join(repoRoot, 'scripts/Link-Skills.ps1');

const hasPwsh = spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' }).status === 0;

describe.skipIf(!hasPwsh)('Link-Skills.ps1', () => {
  let worker: PwshWorker;
  const roots: string[] = [];
  beforeAll(() => {
    worker = new PwshWorker(script);
  });
  afterAll(() => {
    worker.close();
    for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
  });

  // Fixture repo root with two skills in two groups and a folder without SKILL.md.
  const fixture = () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'link-skills-'));
    roots.push(root);
    for (const s of ['delivery/deliver', 'shared/implementation']) {
      fs.mkdirSync(path.join(root, 'skills', s), { recursive: true });
      fs.writeFileSync(path.join(root, 'skills', s, 'SKILL.md'), `# ${s}\n`);
    }
    fs.mkdirSync(path.join(root, 'skills', 'shared', 'no-skill'));
    return root;
  };
  const run = (root: string, ...args: string[]) =>
    worker.run(['-Root', root, ...args], { cwd: root });
  const isLink = (p: string) => fs.lstatSync(p).isSymbolicLink();

  it('links every skill into .claude/skills and .agents/skills', async () => {
    const root = fixture();
    const result = await run(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('linked 4, skipped 0');
    for (const dir of ['.claude/skills', '.agents/skills']) {
      expect(fs.readdirSync(path.join(root, dir)).sort()).toEqual(['deliver', 'implementation']);
      const link = path.join(root, dir, 'deliver');
      expect(isLink(link)).toBe(true);
      expect(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8')).toBe('# delivery/deliver\n');
    }
  });

  it('replaces an existing link and skips a real directory', async () => {
    const root = fixture();
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'link-skills-foreign-'));
    roots.push(elsewhere);
    fs.mkdirSync(path.join(root, '.claude/skills'), { recursive: true });
    fs.symlinkSync(elsewhere, path.join(root, '.claude/skills/deliver'));
    fs.mkdirSync(path.join(root, '.claude/skills/implementation'));
    fs.writeFileSync(path.join(root, '.claude/skills/implementation/SKILL.md'), 'local\n');

    const result = await run(root);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('skipped');
    expect(result.stdout).toContain('real directory');
    expect(result.stdout).toContain('linked 3, skipped 1');
    expect(fs.realpathSync(path.join(root, '.claude/skills/deliver'))).toBe(
      fs.realpathSync(path.join(root, 'skills/delivery/deliver')),
    );
    expect(isLink(path.join(root, '.claude/skills/implementation'))).toBe(false);
    expect(fs.readFileSync(path.join(root, '.claude/skills/implementation/SKILL.md'), 'utf8')).toBe(
      'local\n',
    );
  });

  it('-Remove removes only its own links and keeps real directories and foreign links', async () => {
    const root = fixture();
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'link-skills-foreign-'));
    roots.push(elsewhere);
    await run(root);
    fs.symlinkSync(elsewhere, path.join(root, '.claude/skills/foreign'));
    fs.mkdirSync(path.join(root, '.agents/skills/impl-next'));

    const result = await run(root, '-Remove');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('removed 4 link(s)');
    expect(fs.readdirSync(path.join(root, '.claude/skills'))).toEqual(['foreign']);
    expect(fs.readdirSync(path.join(root, '.agents/skills'))).toEqual(['impl-next']);
    // the link targets are untouched
    expect(fs.existsSync(path.join(root, 'skills/delivery/deliver/SKILL.md'))).toBe(true);
  });

  it('-Remove without link folders exits 0', async () => {
    const result = await run(fixture(), '-Remove');
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('removed 0 link(s)');
  });

  it('fails without a skills folder', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'link-skills-empty-'));
    roots.push(root);
    const result = await run(root);
    expect(result.status).toBe(2);
    expect(fs.existsSync(path.join(root, '.claude'))).toBe(false);
  });
});
