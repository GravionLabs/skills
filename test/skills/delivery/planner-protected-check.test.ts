import { spawnSync } from 'node:child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const skills = path.resolve(__dirname, '../../../skills');
const script = path.join(skills, 'delivery/planner/scripts/check-protected.mts');

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) fs.rmSync(dir, { recursive: true, force: true });
});

type Item = { id: string; body?: string; files?: string[]; labels?: string[] };

function run(items: Item[], opts: { args?: string[]; config?: unknown; level?: string } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'check-protected-'));
  dirs.push(root);
  const plan = path.join(root, 'plan.json');
  fs.writeFileSync(plan, JSON.stringify({ level: opts.level ?? 'pbi', items }));
  if (opts.config) {
    fs.mkdirSync(path.join(root, '.agents'));
    fs.writeFileSync(path.join(root, '.agents/config.json'), JSON.stringify(opts.config));
  }
  const check = (...args: string[]) =>
    spawnSync(process.execPath, [script, '--plan', plan, '--root', root, ...args], {
      encoding: 'utf8',
    });
  const result = check(...(opts.args ?? []));
  return { ...result, check, read: () => JSON.parse(fs.readFileSync(plan, 'utf8')) };
}

const notes = (text: string) => `## Overview\n\nx\n\n## Technical Notes\n\n${text}\n`;
const manifest = 'projects/lint/package.json';

describe('check-protected', () => {
  it('passes a labeled hit that the Technical Notes name', () => {
    const r = run([
      { id: 'p1', files: [manifest], labels: ['interactive'], body: notes(`\`${manifest}\`.`) },
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`hit: p1: ${manifest} (interactive)`);
  });

  it('fails an unlabeled hit and a body that does not name the file', () => {
    // the root manifest is not the nested one
    const r = run([{ id: 'p1', files: [manifest, 'src/a.ts'], body: notes('package.json') }]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(
      `error: p1: changes protected paths (${manifest}) without the label interactive`,
    );
    expect(r.stdout).toContain(`error: p1: Technical Notes do not name ${manifest}`);
  });

  it('--fix labels the item and names the file, then the check passes', () => {
    const body = 'Parent Feature: #1\n\n## Definition of Done\n\n- done\n';
    const r = run(
      [
        { id: 'p1', files: ['./.github/workflows/ci.yml'], labels: ['pbi'], body },
        { id: 'p2', files: [manifest], body: notes('Keep it small.') },
      ],
      { args: ['--fix'] },
    );
    expect(r.status).toBe(0);
    const [first, second] = r.read().items;
    expect(first.labels).toEqual(['pbi', 'interactive']);
    expect(first.body).toMatch(
      /## Technical Notes\n\nProtected paths[^\n]*`\.github\/workflows\/ci\.yml`\n\n## Definition of Done/,
    );
    expect(second.body).toContain(
      `Keep it small.\nProtected paths (a person merges): \`${manifest}\``,
    );
    expect(r.check().status).toBe(0);
  });

  it('allows a manifest change the Technical Notes declare dependency-only', () => {
    const files = [manifest, 'Cargo.toml'];
    const r = run([
      { id: 'p1', files, body: notes(`- Dependency-only: \`${manifest}\`, Cargo.toml`) },
    ]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('');
  });

  it.each([
    ['another section', manifest, `## Overview\n\nDependency-only: ${manifest}\n`],
    ['another file', manifest, notes('Dependency-only: package.json')],
    ['no manifest', '.github/workflows/ci.yml', notes('Dependency-only: .github/workflows/ci.yml')],
    [
      'a protected directory',
      '.claude/x/package.json',
      notes('Dependency-only: .claude/x/package.json'),
    ],
  ])('keeps the hit for a declaration with %s', (_name, file, body) => {
    expect(run([{ id: 'p1', files: [file], body }]).status).toBe(1);
  });

  it('warns about an item without files', () => {
    const r = run([{ id: 'p1', files: [] }]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('warning: p1: no files listed');
  });

  it('uses deliver.protectedPaths instead of the default list', () => {
    const r = run([{ id: 'p1', files: ['infra/main.tf', 'package.json'] }], {
      config: { deliver: { protectedPaths: ['infra/'] } },
    });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('(infra/main.tf)');
  });

  it('skips a plan of Features', () => {
    const r = run([{ id: 'p1', files: ['package.json'] }], { level: 'feature' });
    expect([r.status, r.stdout]).toEqual([0, '']);
  });

  it('exits 64 without the deliver skill', () => {
    const r = run([], { args: ['--deliver-dir', os.tmpdir()] });
    expect(r.status).toBe(64);
    expect(r.stderr).toContain('`deliver` skill');
  });

  it('the references name the script and list the installer files', () => {
    const read = (file: string) =>
      fs.readFileSync(path.join(skills, 'delivery/planner', file), 'utf8');
    for (const file of ['references/ready.md', 'references/slicing.md'])
      expect(read(file)).toContain('check-protected.mts');
    const installer = read('references/slicing.md').split('## Skill installer files')[1]!;
    expect(installer).toContain('`skills-lock.json`');
    expect(installer).toContain('`.claude/skills/*`');
  });
});
