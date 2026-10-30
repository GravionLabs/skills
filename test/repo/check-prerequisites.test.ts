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
});
