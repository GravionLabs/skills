import * as fs from 'fs';
import * as path from 'path';

const pk = path.resolve(__dirname, '../../../skills');
const read = (p: string) => fs.readFileSync(path.join(pk, p), 'utf-8');

const skill = read('github/github-issue/SKILL.md');
const standalone = read('github/github-issue/references/standalone-issue.md');

const implementation = read('shared/implementation/SKILL.md');

describe('two-stage verify rule (#447, #771)', () => {
  it('implementation owns the rule: targeted tests per commit, one full run before the PR, never red', () => {
    expect(implementation).not.toContain('build + full test suite');
    expect(implementation).toMatch(
      /Build passes when the stack compiles and compiled sources changed/,
    );
    expect(implementation).toMatch(/targeted tests pass/);
    expect(implementation).toMatch(/never the full suite/);
    expect(implementation).toMatch(/one full run before the pull request/);
    expect(implementation).toMatch(/again after the last fix round/);
    expect(implementation).toMatch(/Never commit red/);
    expect(implementation).not.toMatch(/Final-Verify/);
  });

  it('SKILL.md delegates to implementation in one line', () => {
    const line = skill.split('\n').find((l) => l.startsWith('- Verify per `implementation`'))!;
    expect(line).toBeDefined();
    expect(line).toMatch(/one full run before the pull request/);
    expect(line).toMatch(/never commit or move on with a red run/i);
    expect(skill).not.toMatch(/never the full suite|Two-stage verify/);
  });

  it('standalone-issue step 9 delegates to implementation and keeps the full-run points', () => {
    const step = standalone.split('\n').find((l) => l.startsWith('9. '))!;
    expect(step).toContain('Verify per `implementation`');
    expect(step).toMatch(/ONE full build \+ test suite run/);
    expect(step).toMatch(/after the last fix round/);
    expect(step).toMatch(/never commit red/);
    expect(step).not.toMatch(/never the full suite/);
  });
});
