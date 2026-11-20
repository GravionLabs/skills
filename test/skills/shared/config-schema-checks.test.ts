import Ajv2020 from 'ajv/dist/2020';
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../..');
const read = (p: string): string => fs.readFileSync(path.join(root, p), 'utf8');
const validate = new Ajv2020({ allErrors: true, strict: false }).compile(
  JSON.parse(read('skills/shared/implementation/schema/config.schema.json')),
);

// #794: fast static checks and the full-suite rule.
describe('config schema: checks', () => {
  it('accepts a fast check as string or array', () => {
    expect(
      validate({
        checks: [
          { name: 'ratchets', command: 'pnpm ratchets', fast: true },
          { command: ['a', 'b'] },
        ],
      }),
    ).toBe(true);
  });

  it.each([
    { checks: {} },
    { checks: [{ fast: true }] },
    { checks: [{ command: '' }] },
    { checks: [{ command: 'x', fast: 'yes' }] },
    { checks: [{ command: 'x', other: 1 }] },
  ])('rejects %j', (cfg) => {
    expect(validate(cfg)).toBe(false);
  });
});

describe('fast checks in the skills', () => {
  it('implementation runs fast checks before tests and limits the full rerun', () => {
    const s = read('skills/shared/implementation/SKILL.md');
    expect(s).toMatch(/Fast checks: .*`checks`.*before the targeted tests and after every fix/);
    expect(s).not.toContain('and again after the last fix round');
    expect(s.split('\n').length).toBeLessThanOrEqual(100);
  });
  it('deliver and the standalone workflow pass the rule on', () => {
    expect(read('skills/delivery/deliver/SKILL.md')).toContain('fast `checks`');
    expect(read('skills/github/github-issue/references/standalone-issue.md')).toContain(
      'fast `checks`',
    );
  });
  it('is documented in project-config.md', () => {
    expect(read('site/usage/project-config.md')).toContain('- `checks`:');
  });
});
