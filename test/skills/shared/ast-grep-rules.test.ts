import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const skill = path.join(root, 'skills/shared/ast-grep-rules');
const SCRIPT = path.join(skill, 'scripts/check-rules.mts');

const GOOD = 'Why: it hides errors. Instead: use the logger. See #123.';
const rule = (id: string, message: string) =>
  `id: ${id}\nlanguage: TypeScript\nmessage: '${message}'\nrule:\n  pattern: foo()\n`;
const rtest = (id: string) => `id: ${id}\nvalid:\n  - bar()\ninvalid:\n  - foo()\n`;

describe('ast-grep-rules check-rules.mts', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'astgrep-'));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const repo = (name: string, rules: Record<string, string>, tests: Record<string, string>) => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(path.join(dir, 'ast-grep/rules'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'ast-grep/rule-tests'), { recursive: true });
    fs.copyFileSync(path.join(skill, 'templates/sgconfig.yml'), path.join(dir, 'sgconfig.yml'));
    for (const [n, c] of Object.entries(rules))
      fs.writeFileSync(path.join(dir, 'ast-grep/rules', n), c);
    for (const [n, c] of Object.entries(tests))
      fs.writeFileSync(path.join(dir, 'ast-grep/rule-tests', n), c);
    return dir;
  };
  const run = (cwd: string, ...args: string[]) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('passes for a complete rule', () => {
    const d = repo('ok', { 'a.yml': rule('a', GOOD) }, { 'a-test.yml': rtest('a') });
    expect(run(d)).toMatchObject({ status: 0, out: '' });
  });

  it.each([
    ['reason', 'Instead: use the logger. See #123.', 'Why'],
    ['replacement', 'Why: it hides errors. See #123.', 'Instead'],
    ['issue', 'Why: it hides errors. Instead: use the logger.', 'See #123'],
  ])('fails for a message without %s', (_n, message, token) => {
    const d = repo(`msg-${_n}`, { 'a.yml': rule('a', message) }, { 'a-test.yml': rtest('a') });
    const r = run(d);
    expect(r.status).toBe(1);
    expect(r.out).toContain('rule a');
    expect(r.out).toContain(token);
  });

  it('fails for a rule without a rule test of its id', () => {
    const d = repo('notest', { 'a.yml': rule('a', GOOD) }, { 'b-test.yml': rtest('b') });
    const r = run(d);
    expect(r.status).toBe(1);
    expect(r.out).toContain('no rule test with id a');
  });

  it('reads folded block messages and several rules in one file', () => {
    const folded = `id: a\nmessage: >\n  Why: x. Instead: y.\n  See #5.\nrule:\n  pattern: foo()\n---\n${rule('b', 'Why: x')}`;
    const d = repo(
      'multi',
      { 'a.yml': folded },
      { 'a-test.yml': `${rtest('a')}---\n${rtest('b')}` },
    );
    const r = run(d);
    expect(r.status).toBe(1);
    expect(r.out).toContain('rule b');
    expect(r.out).not.toContain('rule a');
  });

  it('exits 2 for a missing sgconfig and a bad usage', () => {
    expect(run(tmp, '--config', 'nope.yml').status).toBe(2);
    expect(run(tmp, '--bogus').status).toBe(2);
  });
});

describe('ast-grep-rules skill files', () => {
  const read = (p: string) => fs.readFileSync(path.join(skill, p), 'utf8');

  it('templates form a config that check-rules accepts', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'astgrep-tpl-'));
    try {
      fs.mkdirSync(path.join(tmp, 'ast-grep/rules'), { recursive: true });
      fs.mkdirSync(path.join(tmp, 'ast-grep/rule-tests'), { recursive: true });
      fs.copyFileSync(path.join(skill, 'templates/sgconfig.yml'), path.join(tmp, 'sgconfig.yml'));
      fs.copyFileSync(
        path.join(skill, 'templates/rule.yml'),
        path.join(tmp, 'ast-grep/rules/no-example-call.yml'),
      );
      fs.copyFileSync(
        path.join(skill, 'templates/rule-test.yml'),
        path.join(tmp, 'ast-grep/rule-tests/no-example-call-test.yml'),
      );
      const r = spawnSync(process.execPath, [SCRIPT], { cwd: tmp, encoding: 'utf8' });
      expect(r.status).toBe(0);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('sgconfig template sets the rule and test dirs', () => {
    const c = read('templates/sgconfig.yml');
    expect(c).toContain('ruleDirs:');
    expect(c).toContain('- ast-grep/rules');
    expect(c).toContain('testDir: ast-grep/rule-tests');
  });

  it('SKILL.md is at most 100 lines, documents the message rule and never calls sg', () => {
    const s = read('SKILL.md');
    expect(s.split('\n').length).toBeLessThanOrEqual(100);
    expect(s).toContain('Why: <the reason>. Instead: <the replacement>. See #123.');
    for (const f of [
      'SKILL.md',
      'references/rules.md',
      'templates/sgconfig.yml',
      'scripts/check-rules.mts',
    ])
      expect(read(f)).not.toMatch(/^\s*sg\s/m);
  });

  it('is registered in the shared group, marketplace, groups.json, README and AGENTS', () => {
    const market = fs.readFileSync(path.join(root, '.claude-plugin/marketplace.json'), 'utf8');
    expect(market).toContain('./skills/shared/ast-grep-rules');
    const groups = JSON.parse(
      fs.readFileSync(path.join(root, 'skills/delivery/skills-manage/scripts/groups.json'), 'utf8'),
    );
    expect(JSON.stringify(groups)).toContain('ast-grep-rules');
    for (const f of ['README.md', 'AGENTS.md'])
      expect(fs.readFileSync(path.join(root, f), 'utf8')).toContain('`ast-grep-rules`');
  });
});
