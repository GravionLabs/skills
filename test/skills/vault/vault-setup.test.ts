import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const root = path.resolve(__dirname, '../../..');
const dir = path.join(root, 'skills/vault/vault-setup');
const script = path.join(dir, 'scripts/Invoke-VaultSetup.ps1');
const START = '<!-- vault-core:start -->';
const END = '<!-- vault-core:end -->';

describe('vault-setup (#925)', () => {
  let worker: PwshWorker;
  let tmp: string;
  let n = 0;
  const vault = (files: Record<string, string> = {}) => {
    const v = path.join(tmp, `v${n++}`);
    fs.mkdirSync(v, { recursive: true });
    for (const [f, c] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(v, f)), { recursive: true });
      fs.writeFileSync(path.join(v, f), c);
    }
    return v;
  };
  const run = (v: string, ...args: string[]) =>
    worker.run([...args, '-Vault', v, '-SkipInstall'], { cwd: tmp });
  const cfg = (v: string) =>
    JSON.parse(fs.readFileSync(path.join(v, '.nixe/config.json'), 'utf-8'));
  const claude = (v: string) => fs.readFileSync(path.join(v, 'CLAUDE.md'), 'utf-8');

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-setup-'));
    worker = new PwshWorker(script);
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('SKILL.md documents the commands', () => {
    const s = fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf-8');
    expect(s).toMatch(/^---\nname: vault-setup\n/);
    expect(s.trimEnd().split('\n').length).toBeLessThanOrEqual(100);
    for (const k of [
      'npx skills add',
      'npx skills check',
      'role -List',
      'role -Remove',
      'No commit',
    ])
      expect(s).toContain(k);
  });

  it('core block holds the role rule', () => {
    const c = fs.readFileSync(path.join(dir, 'assets/core/CLAUDE-core.md'), 'utf-8');
    expect(c).toContain('file notes only into a folder with a role');
  });

  it('sets up a school vault in en', async () => {
    const v = vault();
    const r = await run(v, 'setup', 'school');
    expect(r.status).toBe(0);
    const c = cfg(v);
    expect(c.language).toBe('en');
    expect(c.folders.exams).toBe('Exams');
    expect(c.files['school-profile']).toBe('Profile.md');
    // a school-only vault keeps its layout
    expect(c.folders.subjects).toBe('Subjects');
    for (const f of ['Exams', 'Subjects', 'Sources', 'Inbox', 'Templates/Exam.md', 'Profile.md'])
      expect(fs.existsSync(path.join(v, f))).toBe(true);
    const md = claude(v);
    expect(md).toContain(START);
    expect(md).toContain('## Vault-specific rules');
    expect(md).toContain('## School area');
  });

  it('sets up a school vault in de', async () => {
    const v = vault();
    const r = await run(v, 'setup', 'school', '-Language', 'de');
    expect(r.status).toBe(0);
    expect(cfg(v).language).toBe('de');
    for (const f of ['Klausuren', 'Vorlagen/Prüfung.md', 'Profil.md', 'Inbox'])
      expect(fs.existsSync(path.join(v, f))).toBe(true);
    expect(cfg(v).folders.inbox).toBe('Inbox');
    // the inbox stays committed
    expect(fs.existsSync(path.join(v, '.gitignore'))).toBe(false);
    expect(cfg(v).folders.subjects).toBe('.');
    expect(claude(v)).toContain('## Schulbereich');
  });

  it('sets up PARA in de with templates', async () => {
    const v = vault();
    expect((await run(v, 'setup', 'para', '-Language', 'de')).status).toBe(0);
    for (const f of ['Posteingang', 'Projekte', 'Vorlagen/Rezept.md', 'Vorlagen/Besprechung.md'])
      expect(fs.existsSync(path.join(v, f))).toBe(true);
    expect(claude(v)).toContain('PARA-Vault');
  });

  it('falls back to English folder names for another language with a notice', async () => {
    const v = vault();
    const r = await run(v, 'setup', 'para', '-Language', 'fr');
    expect(r.status).toBe(0);
    expect(cfg(v).language).toBe('fr');
    expect(cfg(v).folders.inbox).toBe('Inbox');
    expect(r.stdout + r.stderr).toContain('fr');
  });

  it('keeps existing folders and never overwrites a note', async () => {
    const v = vault({
      '.nixe/config.json': JSON.stringify({ folders: { inbox: 'Eingang' } }),
      'Profile.md': 'mine',
      'CLAUDE.md': `# Mine\n\n## Vault-specific rules\n\nown rule\n`,
    });
    expect((await run(v, 'setup', 'school')).status).toBe(0);
    expect(cfg(v).folders.inbox).toBe('Eingang');
    expect(cfg(v).folders.exams).toBe('Exams');
    expect(fs.readFileSync(path.join(v, 'Profile.md'), 'utf-8')).toBe('mine');
    expect(claude(v)).toContain('own rule');
    expect(claude(v)).toContain(START);
    // a second run changes nothing
    const before = claude(v);
    expect((await run(v, 'setup', 'school')).status).toBe(0);
    expect(claude(v)).toBe(before);
  });

  describe('core block (update)', () => {
    it('inserts a missing block and keeps the text', async () => {
      const v = vault({ 'CLAUDE.md': '# Mine\n\n## Vault-specific rules\n\nown rule\n' });
      const r = await run(v, 'update');
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('inserted');
      const md = claude(v);
      expect(md).toContain(START);
      expect(md.indexOf(START)).toBeLessThan(md.indexOf('## Vault-specific rules'));
      expect(md).toContain('own rule');
    });

    it('replaces a changed block, keeps the own section, then reports unchanged', async () => {
      const v = vault({
        'CLAUDE.md': `# V\n\n${START}\nold rules\n${END}\n\n## Vault-specific rules\n\nown rule\n`,
      });
      const r = await run(v, 'update');
      expect(r.stdout).toContain('replaced');
      const md = claude(v);
      expect(md).not.toContain('old rules');
      expect(md).toContain('file notes only into a folder with a role');
      expect(md).toContain('own rule');
      expect((await run(v, 'update')).stdout).toContain('unchanged');
    });

    it('still updates with a broken config', async () => {
      const v = vault({ '.nixe/config.json': '{ broken' });
      expect((await run(v, 'update')).status).toBe(0);
    });

    it('creates CLAUDE.md when it is missing', async () => {
      const v = vault();
      expect((await run(v, 'update')).stdout).toContain('created');
      expect(claude(v)).toContain('## Vault-specific rules');
    });
  });

  describe('PARA and school in one vault (#1001)', () => {
    // a fake npx on PATH records the skills each setup installs
    const withNpx = () => {
      const bin = path.join(tmp, `bin${n++}`);
      const log = path.join(bin, 'npx.log');
      fs.mkdirSync(bin);
      fs.writeFileSync(
        path.join(bin, 'npx.ps1'),
        `Add-Content -LiteralPath '${log}' -Value ($args -join ' ')\nexit 0\n`,
        { mode: 0o755 },
      );
      const env = { ...process.env };
      const key = Object.keys(env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
      env[key] = `${bin}${path.delimiter}${env[key]}`;
      return { env, log };
    };

    it('setup para then setup school gives one config, both sections and both skill groups', async () => {
      const v = vault();
      const { env, log } = withNpx();
      for (const kind of ['para', 'school']) {
        const r = await worker.run(['setup', kind, '-Vault', v], { cwd: tmp, env });
        expect(r.status).toBe(0);
      }
      const c = cfg(v);
      expect(c.folders).toMatchObject({
        projects: 'Projects',
        areas: 'Areas',
        resources: 'Resources',
        archive: 'Archive',
        subjects: 'Areas/School',
        sources: 'Sources',
        exams: 'Exams',
      });
      expect(c.files).toEqual({ 'school-profile': 'Profile.md' });
      expect(fs.existsSync(path.join(v, 'Areas/School'))).toBe(true);
      expect(fs.existsSync(path.join(v, 'Subjects'))).toBe(false);
      const md = claude(v);
      expect(md).toContain('## PARA vault');
      expect(md).toContain('## School area');
      const installed = fs.readFileSync(log, 'utf-8');
      for (const s of ['vault-inbox', 'vault-weekly-review', 'school-summary', 'school-exam'])
        expect(installed).toContain(`--skill ${s}`);
    });

    it('uses the German names and the language of the vault', async () => {
      const v = vault();
      await run(v, 'setup', 'para', '-Language', 'de');
      expect((await run(v, 'setup', 'school')).status).toBe(0);
      expect(cfg(v).language).toBe('de');
      expect(cfg(v).folders.subjects).toBe('Bereiche/Schule');
      expect(claude(v)).toContain('## Schulbereich');
    });

    it('puts the school below a renamed areas folder', async () => {
      const v = vault({
        '.nixe/config.json': JSON.stringify({
          folders: { areas: { path: '20 Areas/', description: 'ongoing' } },
        }),
      });
      await run(v, 'setup', 'school');
      expect(cfg(v).folders.subjects).toBe('20 Areas/School');
    });

    it('refuses a second setup with another language and changes nothing', async () => {
      const v = vault();
      await run(v, 'setup', 'para', '-Language', 'de');
      const before = [cfg(v), claude(v)];
      const r = await run(v, 'setup', 'school', '-Language', 'en');
      expect(r.status).not.toBe(0);
      expect(r.stdout + r.stderr).toContain("the vault's language is 'de', not 'en'");
      expect([cfg(v), claude(v)]).toEqual(before);
      expect(fs.existsSync(path.join(v, 'Profile.md'))).toBe(false);
    });

    it('keeps files.profile and the old section of an existing school vault', async () => {
      const v = vault({
        '.nixe/config.json': JSON.stringify({ files: { profile: 'Me.md' } }),
        'CLAUDE.md': '# V\n\n## Vault-specific rules\n\n## School vault\n\nold\n',
      });
      expect((await run(v, 'setup', 'school')).status).toBe(0);
      expect(cfg(v).files).toEqual({ profile: 'Me.md' });
      expect(fs.existsSync(path.join(v, 'Me.md'))).toBe(true);
      expect(fs.existsSync(path.join(v, 'Profile.md'))).toBe(false);
      expect(claude(v)).not.toContain('## School area');
    });
  });

  describe('inbox and attachments (#1000)', () => {
    const config = (folders: Record<string, string>, language = 'de') => ({
      '.nixe/config.json': JSON.stringify({ language, folders }),
    });
    const expectProposal = (out: string, name: string) => {
      expect(out).toContain("'attachments'");
      expect(out).toContain("'inbox'");
      expect(out).toContain(`role attachments ${name}`);
    };

    it('role refuses attachments on the inbox of a new German school vault', async () => {
      const v = vault();
      await run(v, 'setup', 'school', '-Language', 'de');
      const r = await run(v, 'role', 'attachments', 'Inbox');
      expect(r.status).not.toBe(0);
      expectProposal(r.stdout + r.stderr, 'Anhänge');
      expect(cfg(v).folders.attachments).toBeUndefined();
    });

    it.each([
      ['inbox on attachments', { attachments: 'Files' }, ['role', 'inbox', './files/']],
      ['attachments on the default inbox', {}, ['role', 'attachments', 'Inbox']],
      ['inbox on the default attachments', {}, ['role', 'inbox', 'Attachments']],
      [
        'removing a role so that the default clashes',
        { inbox: 'In', attachments: 'Inbox' },
        ['role', '-Remove', 'inbox'],
      ],
    ])('role refuses %s', async (_n, folders, args) => {
      const v = vault(config(folders, 'en'));
      const r = await run(v, ...args);
      expect(r.status).not.toBe(0);
      expectProposal(r.stdout + r.stderr, 'Attachments');
      expect(cfg(v).folders).toEqual(folders);
    });

    it('setup refuses to add an inbox on the attachments folder', async () => {
      const v = vault(config({ attachments: 'Posteingang' }));
      const r = await run(v, 'setup', 'para', '-Language', 'de');
      expect(r.status).not.toBe(0);
      expectProposal(r.stdout + r.stderr, 'Anhänge');
      expect(cfg(v).folders).toEqual({ attachments: 'Posteingang' });
    });

    it.each([
      ['setup', ['setup', 'school', '-Language', 'de']],
      ['update', ['update']],
      ['role -List', ['role', '-List']],
    ])('%s warns for an existing vault with both on one folder', async (_n, args) => {
      const v = vault(config({ inbox: '00 Inbox', attachments: '00 Inbox' }));
      const r = await run(v, ...args);
      expect(r.status).toBe(0);
      expect(r.stdout).toContain('warning:');
      expectProposal(r.stdout, 'Anhänge');
      expect(cfg(v).folders.attachments).toBe('00 Inbox');
    });

    it('the proposed command resolves the warning', async () => {
      const v = vault(config({ attachments: 'Inbox' }));
      const r = await run(v, 'role', 'attachments', 'Anhänge');
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain('warning:');
    });
  });

  describe('role', () => {
    it('sets, lists and removes a role', async () => {
      const v = vault();
      expect((await run(v, 'role', 'recipes', 'Areas/Cook', 'Recipes')).status).toBe(0);
      expect(cfg(v).folders.recipes).toEqual({ path: 'Areas/Cook', description: 'Recipes' });
      expect(fs.existsSync(path.join(v, 'Areas/Cook'))).toBe(true);
      expect((await run(v, 'role', 'inbox', 'In')).status).toBe(0);
      expect(cfg(v).folders.inbox).toBe('In');
      const l = await run(v, 'role', '-List');
      expect(l.stdout).toContain('recipes');
      expect((await run(v, 'role', '-Remove', 'recipes')).status).toBe(0);
      expect(cfg(v).folders.recipes).toBeUndefined();
    });

    it.each([
      ['own role without description', ['role', 'recipes', 'R']],
      ['path outside the vault', ['role', 'inbox', '../x']],
      ['absolute path', ['role', 'inbox', '/tmp/x']],
      ['invalid name', ['role', 'Bad Name', 'x', 'd']],
    ])('rejects %s', async (_n, args) => {
      const v = vault();
      expect((await run(v, ...args)).status).not.toBe(0);
    });

    it('rejects a second role for one folder and removing an unknown role', async () => {
      const v = vault();
      expect((await run(v, 'role', 'notes', 'N', 'Notes')).status).toBe(0);
      expect((await run(v, 'role', 'other', 'n', 'Other')).status).not.toBe(0);
      expect((await run(v, 'role', '-Remove', 'nope')).status).not.toBe(0);
    });
  });
});
