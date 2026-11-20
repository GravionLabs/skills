import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parse } from 'yaml';

const skillDir = path.resolve(__dirname, '../../../skills/github/github-workflow-lint');
const script = path.join(skillDir, 'scripts/Invoke-WorkflowLint.ps1');

const have = (tool: string) => spawnSync(tool, ['--version']).status === 0;
const toolsInstalled = have('actionlint') && have('zizmor') && have('shellcheck');

const CLEAN = `name: ci
on: push
permissions: {}
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo hello
`;
const BAD_EXPRESSION = `name: ci
on: push
permissions: {}
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ github.nonexistent_property }}"
`;
const INJECTION = `name: ci
on: pull_request_target
permissions: {}
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: echo "\${{ github.event.pull_request.title }}"
`;

function repoWith(workflow?: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wflint-'));
  if (workflow !== undefined) {
    fs.mkdirSync(path.join(dir, '.github/workflows'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.github/workflows/ci.yml'), workflow);
  }
  return dir;
}

function lint(dir: string, env?: NodeJS.ProcessEnv) {
  return spawnSync('pwsh', ['-NoProfile', '-File', script, '-Path', dir], {
    encoding: 'utf8',
    env: env ?? process.env,
  });
}

describe('github-workflow-lint skill', () => {
  it('stays within 100 lines and names both tools', () => {
    const text = fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8');
    expect(text.split('\n').length).toBeLessThanOrEqual(101);
    expect(text).toContain('actionlint');
    expect(text).toContain('zizmor');
    expect(fs.existsSync(path.join(skillDir, 'references/workflow-lint.md'))).toBe(true);
  });

  it('template pins our reusable workflows to a ref and all other actions to a SHA', () => {
    const cfg = parse(fs.readFileSync(path.join(skillDir, 'templates/zizmor.yml'), 'utf8'));
    expect(cfg.rules['unpinned-uses'].config.policies).toEqual({
      'GravionLabs/ci/*': 'ref-pin',
      '*': 'hash-pin',
    });
  });

  it('is skipped without workflows', () => {
    const r = lint(repoWith());
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('skipped: no workflows');
  });

  it('exits 2 with an install hint when a tool is missing', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'wflint-path-'));
    const pwsh = spawnSync('which', ['pwsh'], { encoding: 'utf8' }).stdout.trim();
    const r = spawnSync(pwsh, ['-NoProfile', '-File', script, '-Path', repoWith(CLEAN)], {
      encoding: 'utf8',
      env: { ...process.env, PATH: empty },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('missing tool actionlint');
    expect(r.stderr).toContain('1.7.12');
  });

  describe.skipIf(!toolsInstalled)('with the tools installed', () => {
    it('a clean workflow passes silently', () => {
      const r = lint(repoWith(CLEAN));
      expect(r.stdout).toBe('');
      expect(r.status).toBe(0);
    });

    it('an expression error fails', () => {
      const r = lint(repoWith(BAD_EXPRESSION));
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('nonexistent_property');
    });

    it('a template-injection fails', () => {
      const r = lint(repoWith(INJECTION));
      expect(r.status).toBe(1);
      expect(r.stdout).toContain('template-injection');
    });
  });
});
