import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../../helpers/pwsh-worker';

const SKILL = path.resolve(__dirname, '../../../skills/shared/project-setup');
const SCRIPT = path.join(SKILL, 'scripts/Add-BaseFiles.ps1');
const hasPwsh = spawnSync('pwsh', ['-NoProfile', '-Command', '1']).status === 0;

describe.skipIf(!hasPwsh)('Add-BaseFiles.ps1', () => {
  let dir: string;
  let worker: PwshWorker;
  beforeAll(() => {
    worker = new PwshWorker(SCRIPT);
  });
  afterAll(() => worker.close());
  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'basefiles-')));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  const write = (rel: string, content = '') => {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  };
  const read = (rel: string) => fs.readFileSync(path.join(dir, rel), 'utf8');
  const exists = (rel: string) => fs.existsSync(path.join(dir, rel));
  const run = async (languages: string[], args: string[] = [], frameworks: string[] = []) => {
    const stack = JSON.stringify({ languages, frameworks, tools: [] });
    const r = await worker.run(['-ProjectRoot', dir, '-StackJson', stack, ...args], { cwd: dir });
    return { ...r, json: r.status === 0 ? JSON.parse(r.stdout) : null };
  };

  describe('.gitattributes', () => {
    it('dry run plans the file and writes nothing', async () => {
      const r = await run(['ts']);
      expect(r.json.gitattributes.action).toBe('create');
      expect(r.json.gitattributes.missing[0]).toBe('* text=auto eol=lf');
      expect(exists('.gitattributes')).toBe(false);
    });
    it('creates it with LF, CRLF and binary rules', async () => {
      await run(['ts'], ['-Apply']);
      const lines = read('.gitattributes').split('\n');
      expect(lines).toContain('* text=auto eol=lf');
      expect(lines).toContain('*.ps1 eol=crlf');
      expect(lines).toContain('*.sln eol=crlf');
      expect(lines).toContain('*.woff2 binary');
    });
    it('shows the missing lines of an existing file and appends only them on apply', async () => {
      write('.gitattributes', '* text=auto eol=lf\n*.png binary');
      const dry = await run(['ts']);
      expect(dry.json.gitattributes.action).toBe('append');
      expect(dry.json.gitattributes.missing).not.toContain('* text=auto eol=lf');
      expect(dry.json.gitattributes.missing).toContain('*.ps1 eol=crlf');
      expect(read('.gitattributes')).toBe('* text=auto eol=lf\n*.png binary');
      await run(['ts'], ['-Apply']);
      const lines = read('.gitattributes').split('\n');
      expect(lines.filter((l) => l === '*.png binary')).toHaveLength(1);
      expect(lines).toContain('*.ttf binary');
    });
    it('leaves a complete file unchanged', async () => {
      await run(['ts'], ['-Apply']);
      const r = await run(['ts'], ['-Apply']);
      expect(r.json.gitattributes.result).toBe('unchanged');
    });
  });

  describe('.gitignore', () => {
    it('appends the entries of each language under a header, ng shares ts', async () => {
      write('.gitignore', 'custom/');
      await run(['ts', 'py'], ['-Apply'], ['angular']);
      const text = read('.gitignore');
      expect(text.startsWith('custom/\n')).toBe(true);
      expect(text).toContain('# ts (project-setup)\nnode_modules/');
      expect(text).toContain('# py (project-setup)\n__pycache__/');
      expect(text.match(/\(project-setup\)/g)).toHaveLength(2);
    });
    it('skips entries that exist and does not repeat on a second run', async () => {
      write('.gitignore', 'node_modules/\nbin/\n');
      const first = await run(['ts', 'dotnet'], ['-Apply']);
      const ts = first.json.gitignore.sections.find((s: any) => s.language === 'ts');
      expect(ts.add).not.toContain('node_modules/');
      const lines = read('.gitignore').split('\n');
      expect(lines.filter((l) => l === 'node_modules/')).toHaveLength(1);
      expect(lines.filter((l) => l === 'bin/')).toHaveLength(1);
      const second = await run(['ts', 'dotnet'], ['-Apply']);
      expect(second.json.gitignore.result).toBe('unchanged');
    });
  });

  describe('hook', () => {
    it('delegates a pure ts repository to setup-biome-husky', async () => {
      const r = await run(['ts'], ['-Apply']);
      expect(r.json.hook.action).toBe('delegate');
      expect(r.json.hook.skill).toBe('setup-biome-husky');
      expect(exists('lefthook.yml')).toBe(false);
    });
    it('delegates Angular and prettier repositories to setup-prettier-eslint-husky', async () => {
      expect((await run(['ts'], [], ['angular'])).json.hook.skill).toBe(
        'setup-prettier-eslint-husky',
      );
      write('.prettierrc', '{}');
      expect((await run(['ts'])).json.hook.skill).toBe('setup-prettier-eslint-husky');
    });
    it('writes one lefthook.yml for all languages incl. ts when a non-ts language exists', async () => {
      const r = await run(['ts', 'py'], ['-Apply']);
      expect(r.json.hook.action).toBe('create');
      const yml = read('lefthook.yml');
      expect(yml).toContain('pre-commit:');
      expect(yml).toContain(
        'pwsh .claude/skills/implementation/scripts/Format-Changed.ps1 -Language ts -Check',
      );
      expect(yml).toContain('-Language py -Check');
    });
    it('does not write the hook in the dry run', async () => {
      await run(['py']);
      expect(exists('lefthook.yml')).toBe(false);
    });
    it('reports a missing lefthook with the install hint', async () => {
      const empty = path.join(dir, 'emptybin');
      fs.mkdirSync(empty);
      const stack = JSON.stringify({ languages: ['go'], frameworks: [], tools: [] });
      const r = await worker.run(['-ProjectRoot', dir, '-StackJson', stack], {
        cwd: dir,
        env: { ...process.env, PATH: empty },
      });
      const json = JSON.parse(r.stdout);
      expect(json.hook.warnings.join()).toContain('brew install lefthook');
      expect(json.hook.warnings.join()).toContain('winget install evilmartians.lefthook');
    });
    it('leaves an existing Husky setup untouched', async () => {
      write('.husky/pre-commit', 'npx lint-staged\n');
      const r = await run(['ts', 'py'], ['-Apply']);
      expect(r.json.hook.action).toBe('exists');
      expect(read('.husky/pre-commit')).toBe('npx lint-staged\n');
      expect(exists('lefthook.yml')).toBe(false);
    });
    it('leaves an existing lefthook.yml untouched', async () => {
      write('lefthook.yml', 'mine: true\n');
      const r = await run(['go'], ['-Apply']);
      expect(r.json.hook.action).toBe('exists');
      expect(read('lefthook.yml')).toBe('mine: true\n');
    });
  });
});
