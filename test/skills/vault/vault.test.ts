import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';
import { groupSkills } from '../../helpers/marketplace';

const root = path.resolve(__dirname, '../../..');
const dir = path.join(root, 'skills/vault');
const script = path.join(dir, 'vault-inbox/scripts/Get-VaultRoles.ps1');
const names = [
  'vault-inbox',
  'vault-clip',
  'vault-summarize',
  'vault-meeting',
  'vault-decision',
  'vault-weekly-review',
  'vault-recipe',
  'vault-pdf',
];
const read = (n: string) => fs.readFileSync(path.join(dir, n, 'SKILL.md'), 'utf-8');

describe('vault skills (#924)', () => {
  it('are all in the group, named like their folder, within 100 lines', () => {
    expect(groupSkills('vault').sort()).toEqual([...names, 'vault-setup'].sort());
    for (const n of names) {
      const s = read(n);
      expect(s).toMatch(new RegExp(`^---\\nname: ${n}\\n`));
      expect(s.trimEnd().split('\n').length).toBeLessThanOrEqual(100);
    }
  });

  it('resolve folders through the roles and use no fixed folder name', () => {
    for (const n of names) {
      const s = read(n);
      expect(s).toContain('Get-VaultRoles.ps1');
      expect(s).not.toMatch(
        /Inbox\/|Resources\/Clippings\/|Projects\/|Areas\/|Journal\/|Templates\//,
      );
      expect(s).toContain('`language`');
    }
  });

  it('vault-inbox files into own roles by description and never into a folder without a role', () => {
    const s = read('vault-inbox');
    expect(s).toContain('description');
    expect(s).toContain('fits no role stays in the inbox');
    expect(s).toContain('File only into a folder that has a role');
  });

  it('vault-inbox proposes first and writes nothing before the approval (#999)', () => {
    const s = read('vault-inbox');
    const at = ['## Review', '## Propose', '## Approve', '## Import'].map((h) => s.indexOf(h));
    expect(at.every((i) => i > 0)).toBe(true);
    expect(at).toEqual([...at].sort((a, b) => a - b));
    expect(s).toMatch(
      /nothing in the vault is created, changed, moved or deleted before the approval/,
    );
    expect(s).toMatch(/\| Files \| What it is \| Target .*\| Note type \| Uncertain points \|/);
    expect(s).toContain('"1–3 ok, 4 to Mathe"');
    expect(s).toContain('A row that is not approved stays in the inbox');
    expect(s).toMatch(/PARA targets .* school targets .* side by side/);
  });

  it('vault-inbox converts, moves once and empties the inbox (#999)', () => {
    const s = read('vault-inbox');
    expect(s).toMatch(/larger than 2000 px or a HEIC .*quality 80, at most 2000 px/);
    expect(s).toMatch(/one JPEG per page at about 150 dpi/);
    expect(s).toMatch(/PDF with real \(selectable\) text stays/);
    expect(s).toContain('pdftoppm -jpeg -jpegopt quality=80 -r 150');
    expect(s).toContain('never re-encoded again');
    expect(s).toContain('Git must store each file only once');
    expect(s).toContain('after a full import the inbox is empty');
    expect(s).not.toContain('never delete them');
  });

  it('the eval case: a mixed inbox gives a proposal table and no write', () => {
    const fx = JSON.parse(
      fs.readFileSync(path.join(root, 'evals/vault-inbox/mixed-inbox.json'), 'utf-8'),
    );
    expect(fx.expected.writesBeforeApproval).toEqual([]);
    expect(fx.expected.movesBeforeApproval).toEqual([]);
    const rows: { files: string[]; noteType: string }[] = fx.expected.proposal;
    expect(rows.map((r) => r.files.length)).toEqual([2, 1]);
    expect(rows.flatMap((r) => r.files)).toEqual(fx.inbox.map((i: { file: string }) => i.file));
    expect(rows[1].noteType).toBe('recipe');
    for (const r of rows)
      expect(Object.keys(r)).toEqual(['files', 'what', 'target', 'noteType', 'uncertain']);
  });

  it('vault-recipe uses the role recipes and points to vault-setup when missing', () => {
    const s = read('vault-recipe');
    expect(s).toContain('`recipes`');
    expect(s).toContain('/vault-setup role recipes');
    expect(s).not.toContain('Kochen');
  });

  it('document the permissions of the vault settings', () => {
    const doc = fs.readFileSync(path.join(dir, 'vault-inbox/references/vault-config.md'), 'utf-8');
    for (const k of [
      'uvx trafilatura',
      'heif-convert',
      'magick',
      'Bash(pdftoppm *)',
      'WebFetch',
      '.obsidian/templates.json',
    ])
      expect(doc).toContain(k);
  });
});

describe('Get-VaultRoles.ps1', () => {
  let worker: PwshWorker;
  let tmp: string;
  const mk = (name: string, cfg?: unknown, extra: Record<string, string> = {}) => {
    const v = path.join(tmp, name);
    fs.mkdirSync(v, { recursive: true });
    if (cfg) {
      fs.mkdirSync(path.join(v, '.nixe'));
      fs.writeFileSync(path.join(v, '.nixe/config.json'), JSON.stringify(cfg));
    }
    for (const [f, c] of Object.entries(extra)) {
      fs.mkdirSync(path.dirname(path.join(v, f)), { recursive: true });
      fs.writeFileSync(path.join(v, f), c);
    }
    return v;
  };
  const roles = async (v: string) => {
    const r = await worker.run(['-Vault', v], { cwd: tmp });
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-roles-'));
    worker = new PwshWorker(script);
  });
  afterAll(async () => {
    worker.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('uses the English defaults without folders', async () => {
    const j = await roles(mk('en', undefined, { 'Inbox/a.md': 'x' }));
    expect(j.language).toBe('en');
    expect(j.folders.inbox).toMatchObject({ path: 'Inbox', exists: true, own: false });
    expect(j.folders.exams.path).toBe('Exams');
    expect(j.folders.clippings.path).toBe('Resources/Clippings');
    expect(j.folders.recipes).toBeUndefined();
    expect(j.templates).toEqual({ folder: 'Templates', source: 'role' });
  });

  it('resolves a German vault: renamed roles, own role, language, template folder', async () => {
    const j = await roles(
      mk(
        'de',
        {
          language: 'de',
          folders: {
            inbox: 'Posteingang',
            exams: 'Prüfungen',
            recipes: { path: 'Areas/Kochen/Rezepte', description: 'Rezepte' },
          },
          templates: { folder: 'Vorlagen' },
        },
        { 'Posteingang/a.md': 'x' },
      ),
    );
    expect(j.language).toBe('de');
    expect(j.folders.inbox).toMatchObject({ path: 'Posteingang', exists: true });
    expect(j.folders.exams.path).toBe('Prüfungen');
    expect(j.folders.journal.path).toBe('Journal');
    expect(j.folders.recipes).toMatchObject({
      path: 'Areas/Kochen/Rezepte',
      description: 'Rezepte',
      own: true,
      exists: false,
    });
    expect(j.templates).toEqual({ folder: 'Vorlagen', source: '.nixe/config.json' });
  });

  it('falls back to .obsidian/templates.json', async () => {
    const j = await roles(
      mk('obs', { language: 'de' }, { '.obsidian/templates.json': '{"folder":"Vorlagen"}' }),
    );
    expect(j.templates).toEqual({ folder: 'Vorlagen', source: '.obsidian/templates.json' });
  });
});
