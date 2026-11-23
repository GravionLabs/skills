import { parse as parseYaml } from 'yaml';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const root = path.resolve(__dirname, '../../..');
const skill = path.join(root, 'skills/shared/secret-scan');
const CHECK = path.join(skill, 'scripts/check-allowlist.mts');
const SCAN = path.join(skill, 'scripts/Invoke-SecretScan.ps1');
const hasGitleaks = spawnSync('gitleaks', ['version']).status === 0;

describe('secret-scan check-allowlist.mts', () => {
  let tmp: string;
  beforeAll(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'secscan-'));
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  const repo = (name: string, files: Record<string, string>) => {
    const dir = path.join(tmp, name);
    fs.mkdirSync(dir, { recursive: true });
    for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), c);
    return dir;
  };
  const run = (cwd: string, ...args: string[]) => {
    const r = spawnSync(process.execPath, [CHECK, ...args], { cwd, encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };

  it('passes for a fingerprint with a reason and an entry with a description', () => {
    const d = repo('ok', {
      '.gitleaksignore': '# fake token of the fixture (#1)\nabc123:a.txt:generic-api-key:1\n',
      '.gitleaks.toml':
        "[extend]\nuseDefault = true\n\n[[allowlists]]\ndescription = \"fake token\"\npaths = ['''a\\.txt''']\n",
    });
    expect(run(d)).toMatchObject({ status: 0, out: '' });
  });

  it('fails for a fingerprint without a reason', () => {
    const d = repo('no-reason', { '.gitleaksignore': 'abc123:a.txt:generic-api-key:1\n' });
    const r = run(d);
    expect(r.status).toBe(1);
    expect(r.out).toContain('.gitleaksignore:1');
  });

  it('fails when a blank line separates the reason from the fingerprint', () => {
    const d = repo('gap', { '.gitleaksignore': '# reason\n\nabc123:a.txt:r:1\n' });
    expect(run(d).status).toBe(1);
  });

  it('fails for an allowlist without a description', () => {
    const d = repo('no-desc', { '.gitleaks.toml': "[[allowlists]]\npaths = ['''a''']\n" });
    const r = run(d);
    expect(r.status).toBe(1);
    expect(r.out).toContain('without a description');
  });

  it('does not take a description of the next table', () => {
    const d = repo('next', {
      '.gitleaks.toml': "[[allowlists]]\npaths = ['''a''']\n\n[[rules]]\ndescription = \"x\"\n",
    });
    expect(run(d).status).toBe(1);
  });

  it('exits 2 for a missing directory', () => {
    expect(run(tmp, path.join(tmp, 'nope')).status).toBe(2);
  });
});

describe('secret-scan template', () => {
  const text = fs.readFileSync(path.join(skill, 'templates/.gitleaks.toml'), 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('#'));

  it('is valid TOML in the subset it uses and extends the default rules', () => {
    for (const l of lines)
      expect(l).toMatch(/^(\[[A-Za-z.]+\]|[A-Za-z]+\s*=\s*("[^"]*"|true|false))$/);
    expect(text).toMatch(/\[extend\]\s*\nuseDefault = true/);
  });

  it('has a commented allowlist example with a description', () => {
    expect(text).toMatch(/^# \[\[allowlists\]\]\n# description = /m);
  });
});

describe.skipIf(!hasGitleaks)('Invoke-SecretScan.ps1 (needs gitleaks)', () => {
  const git = (cwd: string, ...a: string[]) => spawnSync('git', a, { cwd, encoding: 'utf8' });
  const scan = (cwd: string) => {
    const r = spawnSync('pwsh', ['-NoProfile', '-File', SCAN, '-Base', 'main'], {
      cwd,
      encoding: 'utf8',
    });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const mk = () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'secscan-git-'));
    git(d, 'init', '-q', '-b', 'main');
    git(d, 'config', 'user.email', 't@example.com');
    git(d, 'config', 'user.name', 't');
    fs.writeFileSync(path.join(d, 'a.txt'), 'hello\n');
    git(d, 'add', '.');
    git(d, 'commit', '-q', '-m', 'init');
    return d;
  };
  const token = 'ghp_' + 'aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5';

  it('exits 0 for a clean repository', () => {
    const d = mk();
    expect(scan(d).status).toBe(0);
    fs.rmSync(d, { recursive: true, force: true });
  });

  it('exits 1 for a planted token and redacts it', () => {
    const d = mk();
    git(d, 'checkout', '-q', '-b', 'feat');
    fs.writeFileSync(path.join(d, 'b.txt'), `token = ${token}\n`);
    git(d, 'add', '.');
    git(d, 'commit', '-q', '-m', 'add');
    const r = scan(d);
    expect(r.status).toBe(1);
    expect(r.out).not.toContain(token);
    expect(r.out).toContain('REDACTED');
    fs.rmSync(d, { recursive: true, force: true });
  });
});

describe('Invoke-SecretScan.ps1 without gitleaks', () => {
  it.skipIf(hasGitleaks)('exits 2 with an install hint', () => {
    const r = spawnSync('pwsh', ['-NoProfile', '-File', SCAN], { encoding: 'utf8' });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('not installed');
  });
});

describe('secret-scan CI template', () => {
  const file = path.join(skill, 'templates/secret-scan.yml');
  const text = fs.readFileSync(file, 'utf8');
  const doc = parseYaml(text);

  it('has a timeout and read-only permissions', () => {
    expect(doc.permissions).toEqual({ contents: 'read' });
    expect(doc.jobs.gitleaks['timeout-minutes']).toBeGreaterThan(0);
  });

  it('does not use gitleaks-action and pins actions by SHA', () => {
    expect(text).not.toMatch(/gitleaks\/gitleaks-action/);
    for (const m of text.matchAll(/uses:\s*(\S+)/g)) expect(m[1]).toMatch(/@[0-9a-f]{40}$/);
  });

  it('scans only the pull request range, redacted, with a checked pinned binary', () => {
    expect(text).toMatch(/fetch-depth: 0/);
    expect(text).toMatch(/--log-opts="origin\/\$\{BASE_REF\}\.\.HEAD"/);
    expect(text).toMatch(/--redact/);
    expect(doc.env.GITLEAKS_SHA256).toMatch(/^[0-9a-f]{64}$/);
    expect(text).toMatch(/sha256sum --check/);
  });
});
