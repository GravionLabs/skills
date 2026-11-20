import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { PwshWorker } from '../helpers/pwsh-worker';

const SCRIPT = path.resolve(
  __dirname,
  '../../skills/shared/check-prerequisites/scripts/Check-Prerequisites.ps1',
);
const pwshProbe = spawnSync('sh', ['-c', 'command -v pwsh'], { encoding: 'utf8' });
const hasPwsh = pwshProbe.status === 0;
const pwshPath = pwshProbe.stdout.trim();

// An agent file in the old apm-hub source format: apm-hub needed apmw for it, GravionLabs/skills ships no agents.
const SOURCE =
  "---\nname: explorer\ntools: ['read']\nmetadata:\n  claude:\n    tools: [Read]\n---\n\nBody.\n";

describe.skipIf(!hasPwsh || process.platform === 'win32')('Check-Prerequisites.ps1', () => {
  let dir: string;
  let home: string;
  let proj: string;
  let full: string;
  let noNode: string;
  // one pwsh worker runs the script in-process per call; each call gets its own HOME and PATH
  let worker: PwshWorker;

  const linkTools = (target: string, tools: string[]) => {
    fs.mkdirSync(target);
    for (const tool of tools) {
      const found = spawnSync('sh', ['-c', `command -v ${tool}`], {
        encoding: 'utf8',
      }).stdout.trim();
      if (found) fs.symlinkSync(found, path.join(target, tool));
    }
    fs.symlinkSync(pwshPath, path.join(target, 'pwsh'));
  };

  beforeAll(() => {
    worker = new PwshWorker(SCRIPT);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prereq-'));
    full = path.join(dir, 'full');
    noNode = path.join(dir, 'no-node');
    linkTools(full, ['git', 'node', 'npm', 'uname', 'sh']);
    linkTools(noNode, ['git', 'uname', 'sh']);
  });
  afterAll(() => {
    worker.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(dir, 'home-'));
    proj = fs.mkdtempSync(path.join(dir, 'proj-'));
  });

  const run = async (pathDir: string) => {
    const r = await worker.run([], { cwd: proj, env: { HOME: home, PATH: pathDir } });
    return { code: r.status, out: r.stdout };
  };

  it('passes with the core tools and ignores old agent files (no apmw, no dromos)', async () => {
    fs.mkdirSync(path.join(home, '.claude/agents'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude/agents/explorer.md'), SOURCE);
    const r = await run(full);
    expect(r.code).toBe(0);
    expect(r.out).not.toContain('apmw');
    expect(r.out).not.toMatch(/dromos|apm-hub/i);
  });

  it('fails and names Node.js when node is missing', async () => {
    const r = await run(noNode);
    expect(r.code).toBe(1);
    expect(r.out).toContain('Node.js');
  });

  describe('ast-grep with sgconfig.yml', () => {
    it('fails and names ast-grep when sgconfig.yml exists and ast-grep is missing', async () => {
      fs.writeFileSync(path.join(proj, 'sgconfig.yml'), 'ruleDirs:\n  - rules\n');
      const r = await run(full);
      expect(r.code).toBe(1);
      expect(r.out).toContain('ast-grep');
    });

    it('passes without sgconfig.yml and ignores a sg binary', async () => {
      const r = await run(full);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain('ast-grep');
    });

    it('passes with sgconfig.yml when ast-grep is installed', async () => {
      fs.writeFileSync(path.join(proj, 'sgconfig.yml'), 'ruleDirs:\n  - rules\n');
      const withTool = path.join(dir, 'with-ast-grep');
      linkTools(withTool, ['git', 'node', 'npm', 'uname', 'sh']);
      const fake = path.join(withTool, 'ast-grep');
      fs.writeFileSync(fake, '#!/bin/sh\necho "ast-grep 0.0.0"\n', { mode: 0o755 });
      const r = await run(withTool);
      expect(r.code).toBe(0);
      expect(r.out).toContain('ast-grep');
    });
  });

  describe('actionlint, zizmor and shellcheck with .github/workflows/', () => {
    it('fails and names the three tools when .github/workflows exists and they are missing', async () => {
      fs.mkdirSync(path.join(proj, '.github/workflows'), { recursive: true });
      const r = await run(full);
      expect(r.code).toBe(1);
      for (const tool of ['actionlint', 'zizmor', 'shellcheck']) expect(r.out).toContain(tool);
    });

    it('passes without .github/workflows and does not mention them', async () => {
      const r = await run(full);
      expect(r.code).toBe(0);
      for (const tool of ['actionlint', 'zizmor', 'shellcheck']) expect(r.out).not.toContain(tool);
    });

    it('passes with .github/workflows when all three are installed', async () => {
      fs.mkdirSync(path.join(proj, '.github/workflows'), { recursive: true });
      const withTools = path.join(dir, 'with-workflow-tools');
      linkTools(withTools, ['git', 'node', 'npm', 'uname', 'sh']);
      for (const tool of ['actionlint', 'zizmor', 'shellcheck']) {
        fs.writeFileSync(path.join(withTools, tool), `#!/bin/sh\necho "${tool} 0.0.0"\n`, {
          mode: 0o755,
        });
      }
      const r = await run(withTools);
      expect(r.code).toBe(0);
    });
  });

  describe('gitleaks with .gitleaks.toml', () => {
    it('fails and names gitleaks with an install hint when .gitleaks.toml exists and it is missing', async () => {
      fs.writeFileSync(path.join(proj, '.gitleaks.toml'), '[extend]\nuseDefault = true\n');
      const r = await run(full);
      expect(r.code).toBe(1);
      expect(r.out).toContain('gitleaks');
      expect(r.out).toContain('Gitleaks.Gitleaks');
    });

    it('passes without .gitleaks.toml and does not mention gitleaks', async () => {
      const r = await run(full);
      expect(r.code).toBe(0);
      expect(r.out).not.toContain('gitleaks');
    });

    it('passes with .gitleaks.toml when gitleaks is installed', async () => {
      fs.writeFileSync(path.join(proj, '.gitleaks.toml'), '[extend]\nuseDefault = true\n');
      const withTool = path.join(dir, 'with-gitleaks');
      linkTools(withTool, ['git', 'node', 'npm', 'uname', 'sh']);
      fs.writeFileSync(path.join(withTool, 'gitleaks'), '#!/bin/sh\necho "8.0.0"\n', {
        mode: 0o755,
      });
      const r = await run(withTool);
      expect(r.code).toBe(0);
    });
  });
});
