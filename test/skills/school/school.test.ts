import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';
import { groupSkills } from '../../helpers/marketplace';

const root = path.resolve(__dirname, '../../..');
const dir = path.join(root, 'skills/school');
const rolesScript = path.join(root, 'skills/vault/vault-inbox/scripts/Get-VaultRoles.ps1');
const names = [
  'school-summary',
  'school-timeline',
  'school-exercises',
  'school-flashcards',
  'school-exam',
];
const read = (n: string) => fs.readFileSync(path.join(dir, n, 'SKILL.md'), 'utf-8');
const ref = fs.readFileSync(path.join(dir, 'school-summary/references/school-vault.md'), 'utf-8');
const asset = (lang: string, f: string) =>
  fs.readFileSync(path.join(dir, 'school-summary/assets', lang, f), 'utf-8');

describe('school skills (#926)', () => {
  it('are all in the group, named like their folder, within 100 lines', () => {
    expect(groupSkills('school').sort()).toEqual([...names].sort());
    for (const n of names) {
      const s = read(n);
      expect(s).toMatch(new RegExp(`^---\\nname: ${n}\\n`));
      expect(s.trimEnd().split('\n').length).toBeLessThanOrEqual(100);
    }
  });

  it('resolve folders through the roles, read the profile and are written in English', () => {
    for (const n of names) {
      const s = read(n);
      expect(s).toContain('Get-VaultRoles.ps1');
      expect(s).toContain('school-vault.md');
      expect(s).toContain('`language`');
      expect(s).not.toMatch(/Inbox\/|Klausuren\/|Quellen\/|Vorlagen\/|Exams\/|Subjects\//);
      expect(s).not.toMatch(/Thema|Zusammenfassung|Karteikarten/);
    }
    for (const k of [
      'files.school-profile',
      'files.profile',
      'Profile.md',
      'name',
      'grade',
      'school_type',
      'state',
    ])
      expect(ref).toContain(k);
    for (const r of ['inbox', 'subjects', 'sources', 'exams', 'templates'])
      expect(ref).toContain(`\`${r}\``);
    expect(ref).toContain('`lang`');
  });

  it('name patterns per language are documented for every note', () => {
    expect(ref).toContain('<Topic> - Summary.md');
    expect(ref).toContain('<Thema> – Zusammenfassung.md');
    for (const p of ['Timeline', 'Exercises', 'Flashcards', 'Exam', 'Mock exam'])
      expect(ref).toContain(p);
    for (const p of ['Zeitstrahl', 'Übungsaufgaben', 'Karteikarten', 'Klausur', 'Probeklausur'])
      expect(ref).toContain(p);
  });

  it('keep the rules of the originals: collapsed solutions, additions marked, no overwrite', () => {
    expect(ref).toContain('[!success]- Solution');
    expect(ref).toContain('Addition (not from class)');
    expect(ref).toContain('Never delete or overwrite');
    expect(read('school-exercises')).toContain('Round N');
    expect(read('school-flashcards')).toContain('append only new cards');
    expect(read('school-exam')).toContain('collapsed');
  });

  it('ship the school profile assets for English and German', () => {
    for (const lang of ['en', 'de']) {
      const p = asset(lang, 'Profile.md');
      for (const k of ['name:', 'grade:', 'school_type:', 'state:']) expect(p).toContain(k);
      expect(asset(lang, 'Exam.md')).toMatch(/^---\ntype: exam/);
      expect(asset(lang, 'CLAUDE-school.md')).toContain('/school-exam');
      const f = JSON.parse(asset(lang, 'folders.json'));
      expect(Object.keys(f.folders).sort()).toEqual(
        ['exams', 'inbox', 'sources', 'subjects', 'templates'].sort(),
      );
    }
  });
});

describe('school vaults resolved through the roles', () => {
  let worker: PwshWorker;
  let tmp: string;
  const mk = (name: string, lang: string, dirs: string[], profile: string) => {
    const v = path.join(tmp, name);
    fs.mkdirSync(path.join(v, '.nixe'), { recursive: true });
    fs.copyFileSync(
      path.join(dir, 'school-summary/assets', lang, 'folders.json'),
      path.join(v, '.nixe/config.json'),
    );
    for (const d of dirs) fs.mkdirSync(path.join(v, d), { recursive: true });
    fs.writeFileSync(path.join(v, profile), asset(lang, 'Profile.md'));
    return v;
  };
  const roles = async (v: string) => {
    const r = await worker.run(['-Vault', v], { cwd: tmp });
    expect(r.status).toBe(0);
    return JSON.parse(r.stdout);
  };

  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'school-vault-'));
    worker = new PwshWorker(rolesScript);
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('German school vault: German folders, profile file and template folder', async () => {
    const v = mk(
      'de',
      'de',
      ['Inbox', 'Klausuren', 'Vorlagen', 'Geschichte/Weimarer Republik/Quellen'],
      'Profil.md',
    );
    fs.writeFileSync(path.join(v, 'Vorlagen/Klausur.md'), asset('de', 'Exam.md'));
    const j = await roles(v);
    expect(j.language).toBe('de');
    expect(j.folders.inbox).toMatchObject({ path: 'Inbox', exists: true });
    expect(j.folders.exams).toMatchObject({ path: 'Klausuren', exists: true });
    expect(j.folders.sources.path).toBe('Quellen');
    expect(j.folders.subjects.path).toBe('.');
    expect(j.files['school-profile']).toBe('Profil.md');
    expect(j.templates).toEqual({ folder: 'Vorlagen', source: '.nixe/config.json' });
    expect(fs.existsSync(path.join(v, j.files['school-profile']))).toBe(true);
  });

  it('English school vault: English folders and Profile.md', async () => {
    const v = mk(
      'en',
      'en',
      ['Inbox', 'Exams', 'Templates', 'Subjects/History/Weimar Republic/Sources'],
      'Profile.md',
    );
    const j = await roles(v);
    expect(j.language).toBe('en');
    expect(j.folders.inbox).toMatchObject({ path: 'Inbox', exists: true });
    expect(j.folders.exams).toMatchObject({ path: 'Exams', exists: true });
    expect(j.folders.subjects).toMatchObject({ path: 'Subjects', exists: true });
    expect(j.files['school-profile']).toBe('Profile.md');
    expect(j.templates.folder).toBe('Templates');
  });

  it('an older school vault with files.profile keeps its profile file', async () => {
    const v = path.join(tmp, 'legacy');
    fs.mkdirSync(path.join(v, '.nixe'), { recursive: true });
    fs.writeFileSync(path.join(v, '.nixe/config.json'), '{"files":{"profile":"Me.md"}}');
    expect((await roles(v)).files['school-profile']).toBe('Me.md');
    fs.writeFileSync(
      path.join(v, '.nixe/config.json'),
      '{"files":{"profile":"Me.md","school-profile":"School.md"}}',
    );
    expect((await roles(v)).files['school-profile']).toBe('School.md');
  });

  it('a school vault without .nixe/config.json falls back to the English roles', async () => {
    const v = path.join(tmp, 'bare');
    fs.mkdirSync(path.join(v, 'Exams'), { recursive: true });
    const j = await roles(v);
    expect(j.language).toBe('en');
    expect(j.folders.exams).toMatchObject({ path: 'Exams', exists: true });
    expect(j.files['school-profile']).toBe('Profile.md');
  });
});
